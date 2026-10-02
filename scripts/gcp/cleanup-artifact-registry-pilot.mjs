#!/usr/bin/env node
/**
 * Limpeza Artifact Registry (piloto) — read-then-delete com allowlist.
 * Mantém imagens em produção + últimas KEEP_RECENT tags por pacote flux-farma-*.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const execute = process.env.EXECUTE_CLEANUP === 'true';
const KEEP_RECENT = Number(process.env.KEEP_RECENT_TAGS || 2);

const PROD_TAGS = new Set([
  'prod-financial-entries-schema-fix-20260701-1302',
  'prod-financial-entries-schema-fix-20260701-1255',
  'prod-egress-opt-20260701-1032',
  'prod-egress-opt-20260701-1032-web',
  'prod-inbound-split-082-20260608-3910',
  'prod-financial-edit-patch-20260629-1045',
  'prod-financial-edit-patch-20260629-1045-web',
  'prod-financial-entries-schema-fix-20260701-1245',
  'prod-campaign-fix-20260710-1055',
]);

const PROD_DIGESTS = new Set([
  'sha256:e397b91b186f5c8a105c9fe878509e89512e844a537248e9c0a9cb7d080de935',
]);

function gcloud(args) {
  const bin = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
  const out = execFileSync(bin, [...args, '--project', project], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  return out.trim();
}

function listImages(repo, pkg = '') {
  const path = pkg
    ? `${region}-docker.pkg.dev/${project}/${repo}/${pkg}`
    : `${region}-docker.pkg.dev/${project}/${repo}`;
  try {
    const raw = gcloud([
      'artifacts',
      'docker',
      'images',
      'list',
      path,
      '--include-tags',
      '--format=json',
      '--limit',
      '5000',
    ]);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    const msg = String(e?.stderr || e?.stdout || e?.message || e);
    if (msg.includes('NOT_FOUND')) return [];
    throw e;
  }
}

function deleteImage(packageUri, version) {
  const ref = `${packageUri}@${version}`;
  console.log(execute ? 'DELETE' : 'WOULD_DELETE', ref);
  if (!execute) return true;
  try {
    gcloud(['artifacts', 'docker', 'images', 'delete', ref, '--quiet', '--delete-tags']);
    return true;
  } catch (e) {
    const msg = String(e?.stderr || e?.stdout || e?.message || e);
    console.error('FAILED', ref, msg.split('\n').slice(-2).join(' '));
    report.errors = report.errors || [];
    report.errors.push({ ref, error: msg });
    return false;
  }
}

const report = { execute, deleted: [], kept: [], skipped: [] };

// 1) cloud-run-source-deploy — repositório legado (~14 GB); ignorar se já removido
const legacyRepo = 'cloud-run-source-deploy';
const legacyImages = listImages(legacyRepo);
if (!legacyImages.length) {
  console.log(`Repo ${legacyRepo} vazio ou inexistente — pulando.`);
}
for (const img of legacyImages) {
  const pkg = img.package || '';
  const ver = img.version || '';
  if (!pkg || !ver) continue;
  report.deleted.push({ repo: legacyRepo, package: pkg, version: ver, reason: 'legacy source-deploy' });
  deleteImage(pkg, ver);
}

// 2) panel-services flux-farma-* — manter prod tags + últimas N por pacote
const fluxPackages = [
  'flux-farma-api',
  'flux-farma-web',
  'flux-farma-webhook',
  'flux-farma-orchestrator',
  'flux-farma-scheduler',
  'flux-farma-campaign',
];

for (const pkg of fluxPackages) {
  const images = listImages('panel-services', pkg);
  const sorted = images.sort((a, b) => String(b.updateTime).localeCompare(String(a.updateTime)));
  const keepVersions = new Set();

  for (const img of sorted) {
    const rawTags = img.tags;
    const tags = Array.isArray(rawTags)
      ? rawTags
      : String(rawTags || '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
    if (tags.some((t) => PROD_TAGS.has(t))) keepVersions.add(img.version);
    if (PROD_DIGESTS.has(img.version)) keepVersions.add(img.version);
  }

  for (const img of sorted.slice(0, KEEP_RECENT)) {
    if (img.version) keepVersions.add(img.version);
  }

  for (const img of sorted) {
    const ver = img.version;
    const pkgUri = img.package;
    if (!ver || !pkgUri) continue;
    if (keepVersions.has(ver)) {
      report.kept.push({ package: pkgUri, version: ver, tags: img.tags || '' });
      continue;
    }
    report.deleted.push({ package: pkgUri, version: ver, tags: img.tags || '', reason: 'old flux-farma tag' });
    deleteImage(pkgUri, ver);
  }
}

mkdirSync('reports', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = join('reports', `artifact-registry-cleanup-${stamp}.json`);
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(`\nModo: ${execute ? 'EXECUTE' : 'DRY-RUN'}`);
console.log(`Mantidas: ${report.kept.length} | Marcadas para delete: ${report.deleted.length} | Erros: ${(report.errors || []).length}`);
console.log(`Relatorio: ${out}`);
