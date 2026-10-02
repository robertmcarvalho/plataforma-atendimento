#!/usr/bin/env node
/**
 * Auditoria read-only de custo Cloud Run / GCP (projeto rh-coopmob-bot).
 * Usage: node scripts/gcp/audit-cloud-run-cost.mjs [--days=30]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.join('=') || 'true'];
  })
);

const projectId = args.project || process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = args.region || process.env.GCP_REGION || 'us-central1';
const days = Number(args.days || 30);
const outDir = args.outDir || 'reports';

function gcloud(args, { json = true } = {}) {
  const bin = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
  try {
    const fmt = json ? ['--format=json'] : [];
    const out = execFileSync(bin, [...args, '--project', projectId, ...fmt], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    return json ? (out.trim() ? JSON.parse(out) : null) : out.trim();
  } catch (e) {
    const msg = String(e?.stderr || e?.stdout || e?.message || e);
    return { error: msg };
  }
}

function estimateWarmInstanceUsdPerMonth({ vcpu = 1, memoryGi = 0.5, cpuAlwaysOn = true }) {
  const seconds = 30 * 24 * 3600;
  const cpuRate = cpuAlwaysOn ? 0.000018 : 0.0000025;
  const memRate = 0.000002;
  const cpu = seconds * vcpu * cpuRate;
  const mem = seconds * memoryGi * memRate;
  return { cpu_usd: round(cpu), memory_usd: round(mem), total_usd: round(cpu + mem) };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

function parseCpu(cpu) {
  if (!cpu) return 1;
  const s = String(cpu);
  if (s.endsWith('m')) return (Number(s.replace('m', '')) || 1000) / 1000;
  return Number(s) || 1;
}

function parseMemoryGi(mem) {
  if (!mem) return 0.5;
  const s = String(mem);
  if (s.endsWith('Gi')) return Number(s.replace('Gi', '')) || 0.5;
  if (s.endsWith('Mi')) return (Number(s.replace('Mi', '')) || 512) / 1024;
  return 0.5;
}

const servicesRaw = gcloud(['run', 'services', 'list', '--region', region]);
const services = Array.isArray(servicesRaw) ? servicesRaw : [];
if (servicesRaw?.error) {
  console.error('gcloud run services list failed:', servicesRaw.error);
}
const serviceRows = services.map((svc) => {
  const name = svc.metadata?.name;
  const detail = gcloud(['run', 'services', 'describe', name, '--region', region]) || {};
  const ann = detail.spec?.template?.metadata?.annotations || {};
  const res = detail.spec?.template?.spec?.containers?.[0]?.resources?.limits || {};
  const min = ann['autoscaling.knative.dev/minScale'] || '0';
  const throttle = ann['run.googleapis.com/cpu-throttling'] ?? 'true';
  const cpuAlwaysOn = min !== '0' && throttle === 'false';
  const vcpu = parseCpu(res.cpu);
  const memGi = parseMemoryGi(res.memory);
  const estimate =
    min !== '0'
      ? estimateWarmInstanceUsdPerMonth({ vcpu, memoryGi: memGi, cpuAlwaysOn })
      : { cpu_usd: 0, memory_usd: 0, total_usd: 0, note: 'scale-to-zero' };

  return {
    service: name,
    min_instances: min,
    max_instances: ann['autoscaling.knative.dev/maxScale'] || null,
    cpu: res.cpu || null,
    memory: res.memory || null,
    cpu_throttling: throttle,
    vpc_connector: ann['run.googleapis.com/vpc-access-connector'] || null,
    warm_estimate_usd_month: estimate,
  };
});

const warmTotal = round(
  serviceRows.reduce((s, r) => s + (Number(r.warm_estimate_usd_month?.total_usd) || 0), 0)
);

const since = new Date();
since.setDate(since.getDate() - days);
const sinceStr = since.toISOString().slice(0, 10);
const buildsRaw = gcloud(['builds', 'list', '--limit', '200', `--filter=createTime>=${sinceStr}T00:00:00Z`]);
const builds = Array.isArray(buildsRaw) ? buildsRaw : [];
const buildStats = (Array.isArray(builds) ? builds : []).reduce(
  (acc, b) => {
    acc.total += 1;
    acc[b.status] = (acc[b.status] || 0) + 1;
    return acc;
  },
  { total: 0 }
);

const connectors = gcloud(['compute', 'networks', 'vpc-access', 'connectors', 'list', '--region', region]) || [];
const connectorRows = (Array.isArray(connectors) ? connectors : []).map((c) => ({
  name: c.name?.split('/').pop(),
  state: c.state,
  min_instances: c.minInstances,
  max_instances: c.maxInstances,
  machine_type: c.machineType,
}));

const repos = gcloud(['artifacts', 'repositories', 'list', '--location', region]) || [];
const repoRows = (Array.isArray(repos) ? repos : []).map((r) => ({
  name: r.name?.split('/').pop(),
  format: r.format,
  size_mb: r.sizeBytes ? Math.round(Number(r.sizeBytes) / 1024 / 1024) : null,
}));

const billing = gcloud(['billing', 'projects', 'describe', projectId]) || {};

const report = {
  generated_at: new Date().toISOString(),
  mode: 'readonly',
  project_id: projectId,
  region,
  billing_account: billing.billingAccountName || null,
  cloud_run: {
    service_count: serviceRows.length,
    warm_instances_estimate_usd_month: warmTotal,
    warm_instances_estimate_brl_month: round(warmTotal * 5.8),
    services: serviceRows.sort((a, b) => b.warm_estimate_usd_month.total_usd - a.warm_estimate_usd_month.total_usd),
  },
  cloud_build: {
      window_days: days,
      ...buildStats,
  },
  vpc_connectors: connectorRows,
  artifact_registry: {
    repositories: repoRows,
    total_size_mb: repoRows.reduce((s, r) => s + (r.size_mb || 0), 0),
  },
  recommendations: [
    warmTotal > 100
      ? 'Revisar servicos com min=1 e --no-cpu-throttling (maior driver de custo).'
      : null,
    buildStats.total > 20
      ? `Alto volume de Cloud Build (${buildStats.total} em ${days}d) — agrupar deploys.`
      : null,
    connectorRows.some((c) => c.state === 'ERROR')
      ? 'Remover VPC connectors em ERROR sem uso (conn-wa-staging).'
      : null,
    repoRows.some((r) => (r.size_mb || 0) > 5000)
      ? 'Limpar tags antigas no Artifact Registry.'
      : null,
    'CUD: aguardar baseline estavel; validar FinOps Hub com Billing Admin.',
  ].filter(Boolean),
};

mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const jsonPath = join(outDir, `cloud-run-cost-audit-${stamp}.json`);
const txtPath = join(outDir, `cloud-run-cost-audit-${stamp}.txt`);

const txt = [
  `Cloud Run cost audit — ${projectId}`,
  `generated_at=${report.generated_at}`,
  '',
  `Servicos Run: ${report.cloud_run.service_count}`,
  `Estimativa instancias quentes: US$ ${warmTotal}/mes (~R$ ${report.cloud_run.warm_instances_estimate_brl_month})`,
  `Cloud Build (${days}d): ${buildStats.total} (${JSON.stringify(buildStats)})`,
  `Artifact Registry: ${report.artifact_registry.total_size_mb} MB`,
  '',
  'Top custo (estimativa min-instance):',
  ...serviceRows
    .filter((s) => s.warm_estimate_usd_month.total_usd > 0)
    .map(
      (s) =>
        `  - ${s.service}: US$ ${s.warm_estimate_usd_month.total_usd}/mes (min=${s.min_instances}, throttle=${s.cpu_throttling})`
    ),
  '',
  'Recomendacoes:',
  ...report.recommendations.map((r) => `  - ${r}`),
].join('\n');

writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(txtPath, `${txt}\n`);

console.log(txt);
console.log(`\nJSON: ${jsonPath}`);
console.log(`TXT:  ${txtPath}`);
