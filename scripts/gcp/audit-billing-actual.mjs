#!/usr/bin/env node
/**
 * Cruza estimativa de custo com dados reais de billing (Cloud Billing API + tabela de serviços).
 * Usage: node scripts/gcp/audit-billing-actual.mjs [--days=7]
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
const days = Number(args.days || 7);

function gcloud(cmdArgs, { json = true } = {}) {
  const bin = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
  try {
    const fmt = json ? ['--format=json'] : [];
    const out = execFileSync(bin, [...cmdArgs, '--project', projectId, ...fmt], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    return json ? (out.trim() ? JSON.parse(out) : null) : out.trim();
  } catch (e) {
    return { error: String(e?.stderr || e?.stdout || e?.message || e) };
  }
}

const billingProject = gcloud(['billing', 'projects', 'describe', projectId]) || {};
const billingAccount = billingProject.billingAccountName?.replace('billingAccounts/', '') || null;

const end = new Date();
const start = new Date();
start.setDate(start.getDate() - days);
const startStr = start.toISOString().slice(0, 10);
const endStr = end.toISOString().slice(0, 10);

let billingQuery = null;
if (billingAccount) {
  billingQuery = gcloud([
    'beta',
    'billing',
    'accounts',
    'projects',
    'describe',
    projectId,
    '--billing-account',
    billingAccount,
  ]);
}

// Cloud Run request metrics via logging (proxy for activity post-throttle)
const runServices = ['flux-farma-webhook', 'flux-farma-orchestrator', 'flux-farma-api'];
const logCounts = {};
for (const svc of runServices) {
  try {
    const bin = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
    const out = execFileSync(
      bin,
      [
        'logging',
        'read',
        `resource.type=cloud_run_revision AND resource.labels.service_name="${svc}" AND severity>=ERROR`,
        `--freshness=${days}d`,
        '--limit',
        '1000',
        '--format=value(timestamp)',
        '--project',
        projectId,
      ],
      { encoding: 'utf8', shell: process.platform === 'win32' }
    );
    const lines = out.trim() ? out.trim().split(/\r?\n/).filter(Boolean) : [];
    logCounts[svc] = { errors_sampled: lines.length, capped_at_1000: lines.length >= 1000 };
  } catch (e) {
    logCounts[svc] = { error: String(e?.message || e) };
  }
}

// Try billing export via bq if dataset exists
let bqCosts = null;
const bqProbe = gcloud(['bq', 'ls', '--format=json']);
const datasets = Array.isArray(bqProbe) ? bqProbe : [];
const billingDs = datasets.find((d) => /billing|export/i.test(String(d.datasetReference?.datasetId || d.id || '')));
if (billingDs) {
  const ds = billingDs.datasetReference?.datasetId || String(billingDs.id || '').split(':').pop();
  bqCosts = { dataset: ds, note: 'Billing export dataset found — run dedicated SQL for line items.' };
}

const report = {
  generated_at: new Date().toISOString(),
  project_id: projectId,
  window_days: days,
  window: { start: startStr, end: endStr },
  billing_account: billingAccount,
  billing_enabled: billingProject.billingEnabled ?? null,
  billing_project_describe: billingProject.error ? { error: billingProject.error } : billingProject,
  cloud_run_errors_sampled: logCounts,
  bigquery_billing_export: bqCosts,
  notes: [
    'Custos reais detalhados exigem Billing Export (BigQuery) ou FinOps Hub no Console.',
    'Estimativa de instancias quentes: npm run gcp:audit:cost',
    `Janela analisada: ${startStr} a ${endStr}`,
  ],
};

mkdirSync('reports', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const jsonPath = join('reports', `billing-actual-audit-${stamp}.json`);
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify(report, null, 2));
console.log(`\nJSON: ${jsonPath}`);
