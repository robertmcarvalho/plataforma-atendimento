#!/usr/bin/env node
/**
 * Lista (dry-run) ou remove tags antigas do Artifact Registry, mantendo as N mais recentes por imagem.
 *
 * Dry-run (padrao):
 *   node scripts/gcp/cleanup-artifact-registry-tags.mjs
 *
 * Executar (requer confirmacao):
 *   $env:CONFIRM_ARTIFACT_REGISTRY_CLEANUP="true"
 *   node scripts/gcp/cleanup-artifact-registry-tags.mjs --execute --keep=5
 */
import { execFileSync } from 'node:child_process';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.join('=') || 'true'];
  })
);

const projectId = args.project || process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = args.region || 'us-central1';
const repo = args.repo || 'panel-services';
const keep = Number(args.keep || 8);
const execute = args.execute === 'true' && process.env.CONFIRM_ARTIFACT_REGISTRY_CLEANUP === 'true';

function gcloud(args) {
  const bin = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
  return execFileSync(bin, [...args, '--project', projectId], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  }).trim();
}

function tryGcloud(args) {
  try {
    gcloud(args);
    return { ok: true };
  } catch (error) {
    const stderr = String(error?.stderr || error?.message || error);
    return { ok: false, stderr };
  }
}

const imagesRaw = gcloud([
  'artifacts',
  'docker',
  'images',
  'list',
  `${region}-docker.pkg.dev/${projectId}/${repo}`,
  '--include-tags',
  '--sort-by=~CREATE_TIME',
  '--format=value(package,version,tags,CREATE_TIME)',
]);

const packages = new Map();
for (const line of imagesRaw.split('\n').filter(Boolean)) {
  const [pkg, version, tags, created] = line.split('\t');
  if (!packages.has(pkg)) packages.set(pkg, []);
  packages.get(pkg).push({ version, tags: tags || '(untagged)', created });
}

let deleteCount = 0;
const plan = [];

for (const [pkg, versions] of packages) {
  const toDelete = versions.slice(keep).sort((a, b) => {
    const aTagged = a.tags !== '(untagged)';
    const bTagged = b.tags !== '(untagged)';
    if (aTagged === bTagged) return 0;
    return aTagged ? -1 : 1;
  });
  if (!toDelete.length) continue;
  plan.push({ package: pkg, keep, delete: toDelete.length, versions: toDelete });
  deleteCount += toDelete.length;
}

console.log(JSON.stringify({ mode: execute ? 'execute' : 'dry-run', repo, keep, packages: packages.size, deleteCount }, null, 2));

for (const item of plan) {
  console.log(`\n${item.package}: manter ${item.keep}, apagar ${item.delete}`);
  for (const v of item.versions.slice(0, 5)) {
    console.log(`  - ${v.version} ${v.tags} (${v.created})`);
  }
  if (item.versions.length > 5) console.log(`  ... +${item.versions.length - 5} mais`);
}

if (!execute) {
  console.log('\nDry-run. Para apagar: CONFIRM_ARTIFACT_REGISTRY_CLEANUP=true --execute --keep=N');
  process.exit(0);
}

let removedCount = 0;
let skippedCount = 0;
let failedCount = 0;

for (const item of plan) {
  for (const v of item.versions) {
    const ref = `${item.package}@${v.version}`;
    console.log('Deleting', ref);
    const result = tryGcloud(['artifacts', 'docker', 'images', 'delete', ref, '--delete-tags', '--quiet']);
    if (result.ok) {
      removedCount += 1;
      continue;
    }

    if (result.stderr.includes('manifest is referenced by parent manifests')) {
      skippedCount += 1;
      console.warn(`Skipping referenced child manifest: ${ref}`);
      continue;
    }

    if (result.stderr.includes('PERMISSION_DENIED')) {
      skippedCount += 1;
      console.warn(`Skipping denied Artifact Registry operation: ${ref}`);
      continue;
    }

    failedCount += 1;
    console.error(`Failed to delete ${ref}`);
    console.error(result.stderr);
  }
}

console.log(
  `\nConcluido. planejadas=${deleteCount} removidas=${removedCount} puladas=${skippedCount} falhas=${failedCount}.`
);
if (failedCount > 0) process.exit(1);
