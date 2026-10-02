#!/usr/bin/env node
/**
 * Deploy API + Web: Acertos UI (diÃ¡ria vs quinta) + guarda em generateDriverPayablesFromCycle
 * para nÃ£o embutir diÃ¡rias legadas no AP semanal.
 *
 *   node scripts/deploy/deploy-production-billing-acertos-daily-ui.mjs
 *
 * PÃ³s-deploy obrigatÃ³rio:
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
const tag = process.env.DEPLOY_TAG || `prod-billing-unified-${stamp}`;

const subs = JSON.parse(readFileSync(path.join(repoRoot, 'reports', 'web-build-substitutions.json'), 'utf8'));
if (!subs.url?.includes('omhlbavfsttwcnybzvcd')) {
  throw new Error('reports/web-build-substitutions.json deve apontar para omhlb (produÃ§Ã£o)');
}

const apiImage = `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-api:${tag}`;
const webImage = `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-web:${tag}-web`;

function run(cmd) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

console.log(JSON.stringify({ tag, apiImage, webImage, project, region }, null, 2));

run(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api.yaml --project=${project} --substitutions=_TAG=${tag},_REGION=${region},_REPO=${repo}`
);

const webSub = [
  `_TAG=${tag}-web`,
  `_REGION=${region}`,
  `_REPO=${repo}`,
  `_NEXT_PUBLIC_API_URL=${subs.api}`,
  `_NEXT_PUBLIC_SUPABASE_URL=${subs.url}`,
  `_NEXT_PUBLIC_SUPABASE_ANON_KEY=${subs.anon}`,
  `_NEXT_PUBLIC_BILLING_MODULE_ENABLED=true`,
].join(',');

run(`gcloud builds submit . --config=deploy/cloudbuild-flux-farma-web.yaml --project=${project} --substitutions="${webSub}"`);

run(`gcloud run services update flux-farma-api --project=${project} --region=${region} --image=${apiImage} --update-env-vars=BILLING_MODULE_ENABLED=true`);
run(`gcloud run services update flux-farma-web --project=${project} --region=${region} --image=${webImage}`);

const report = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  `api_image=${apiImage}`,
  `web_image=${webImage}`,
  '',
  'Post-deploy obrigatorio:',
  '  $env:GCP_PROJECT_ID = "rh-coopmob-bot"',
  '  .\\scripts\\gcp\\post-deploy-pilot.ps1',
  '',
  'Smoke:',
  '  https://www.aetheraai.com.br/billing/acertos',
  '  https://www.aetheraai.com.br/billing/pagar',
].join('\n');

const reportPath = path.join(repoRoot, 'reports', `deploy-billing-unified-${stamp}.txt`);
writeFileSync(reportPath, report + '\n', 'utf8');
writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n', 'utf8');
console.log(report);
console.log('Report:', reportPath);


