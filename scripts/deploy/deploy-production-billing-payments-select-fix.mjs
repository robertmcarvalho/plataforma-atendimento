#!/usr/bin/env node
/**
 * Deploy flux-farma-api: fix GET /billing/payments e /payments/unreconciled
 * (select referenciava billing_payables.beneficiary_name — coluna inexistente → 500,
 * "Baixas registradas" sempre vazia na Conciliação).
 *
 *   node scripts/deploy/deploy-production-billing-payments-select-fix.mjs
 *
 * Pós-deploy piloto incluso (regra AGENTS.md).
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const repo = process.env.GCP_ARTIFACT_REPO || 'panel-services';
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Date.now()).slice(-4);
const tag = process.env.DEPLOY_TAG || `prod-billing-payments-select-fix-${stamp}`;

const apiImage = `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-api:${tag}`;

function run(cmd) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

console.log(JSON.stringify({ tag, apiImage, project, region }, null, 2));

run(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api.yaml --project=${project} --substitutions=_TAG=${tag},_REGION=${region},_REPO=${repo}`
);
run(`gcloud run services update flux-farma-api --project=${project} --region=${region} --image=${apiImage}`);

run(
  `powershell -ExecutionPolicy Bypass -Command "$env:GCP_PROJECT_ID='${project}'; & .\\scripts\\gcp\\post-deploy-pilot.ps1"`
);

const report = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  `api_image=${apiImage}`,
  '',
  'Fix: remove beneficiary_name do select de billing_payables em',
  '  GET /billing/payments e GET /billing/payments/unreconciled',
  'Sintoma: 500 (42703) -> "Baixas registradas" vazia apos confirmar sugestoes.',
  'Smoke:',
  '  /billing/conciliacao — selecionar conta C6 — Baixas registradas lista baixas',
  '  Breno (R$ 1.296,00) e Francisco (R$ 700,00) visiveis, chip Conciliada',
].join('\n');

const reportPath = path.join(repoRoot, 'reports', `deploy-billing-payments-select-fix-${stamp}.txt`);
writeFileSync(reportPath, report + '\n', 'utf8');
writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n', 'utf8');
console.log('\nDeploy payments select fix concluído:', { tag, reportPath });
