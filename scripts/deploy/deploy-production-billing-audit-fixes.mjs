#!/usr/bin/env node
/**
 * Build + deploy API e Web — ocorrência "Diária contratada (trabalhou)".
 *
 *   node scripts/deploy/deploy-production-billing-audit-fixes.mjs
 *
 * Pós-deploy obrigatório:
 *   npm run gcp:post-deploy:pilot
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const repo = 'panel-services';
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Date.now()).slice(-4);
const tag = process.env.DEPLOY_TAG || `prod-billing-audit-fixes-${stamp}`;

const subs = JSON.parse(readFileSync(path.join(repoRoot, 'reports', 'web-build-substitutions.json'), 'utf8'));
if (!subs.url?.includes('omhlbavfsttwcnybzvcd')) {
  throw new Error('reports/web-build-substitutions.json deve apontar para omhlb (produção)');
}

const apiImage = `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-api:${tag}`;

function run(cmd) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

console.log(JSON.stringify({ tag, apiImage, project, region, scope: 'api-only' }, null, 2));

run(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api.yaml --project=${project} --substitutions=_TAG=${tag},_REGION=${region},_REPO=${repo}`
);

run(
  `gcloud run services update flux-farma-api --project=${project} --region=${region} --image=${apiImage} --update-env-vars=BILLING_MODULE_ENABLED=true`
);
const report = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  `api_image=${apiImage}`,
  `scope=api-only`,
  '',
  'Feature: occurrence_kind=contracted_daily (Diária contratada trabalhou)',
  '',
  'Post-deploy obrigatorio:',
  '  $env:GCP_PROJECT_ID = "rh-coopmob-bot"',
  '  .\\scripts\\gcp\\post-deploy-pilot.ps1',
  '',
  'Smoke:',
  '  /lider/faltas ou /financial → Ocorrência → Diária contratada (trabalhou)',
].join('\n');

const reportPath = path.join(repoRoot, 'reports', `deploy-billing-audit-fixes-${stamp}.txt`);
writeFileSync(reportPath, report + '\n', 'utf8');
writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n', 'utf8');
console.log(report);
console.log('Report:', reportPath);
