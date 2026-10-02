#!/usr/bin/env node
/**
 * Build + deploy API e Web (motor financeiro / ciclos).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Date.now()).slice(-4);
const tag = `prod-financial-cycle-${stamp}`;

const subs = JSON.parse(readFileSync(path.join(repoRoot, 'reports', 'web-build-substitutions.json'), 'utf8'));
if (!subs.url?.includes('omhlbavfsttwcnybzvcd')) {
  throw new Error('reports/web-build-substitutions.json deve apontar para omhlb');
}

const apiImage = `${region}-docker.pkg.dev/${project}/panel-services/flux-farma-api:${tag}`;
const webImage = `${region}-docker.pkg.dev/${project}/panel-services/flux-farma-web:${tag}-web`;

console.log('Building API', apiImage);
execSync(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api.yaml --project=${project} --substitutions=_TAG=${tag},_REGION=${region},_REPO=panel-services`,
  { cwd: repoRoot, stdio: 'inherit', shell: true }
);

const subArg = [
  `_TAG=${tag}-web`,
  `_REGION=${region}`,
  `_REPO=panel-services`,
  `_NEXT_PUBLIC_API_URL=${subs.api}`,
  `_NEXT_PUBLIC_SUPABASE_URL=${subs.url}`,
  `_NEXT_PUBLIC_SUPABASE_ANON_KEY=${subs.anon}`,
].join(',');

console.log('Building Web', webImage);
execSync(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-web.yaml --project=${project} --substitutions=${subArg}`,
  { cwd: repoRoot, stdio: 'inherit', shell: true }
);

console.log('Deploying flux-farma-api...');
execSync(
  `gcloud run services update flux-farma-api --project=${project} --region=${region} --image=${apiImage}`,
  { stdio: 'inherit', shell: true }
);

console.log('Deploying flux-farma-web...');
execSync(
  `gcloud run services update flux-farma-web --project=${project} --region=${region} --image=${webImage}`,
  { stdio: 'inherit', shell: true }
);

const report = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  `api_image=${apiImage}`,
  `web_image=${webImage}`,
  '',
  'Post-deploy:',
  '  1. UI Financeiro → Configurações → Simular recálculo',
  '  2. Revisar reports/financial-recalculate-*.txt',
  '  3. Recalcular em massa (se OK)',
].join('\n');

const reportPath = path.join(repoRoot, 'reports', `deploy-financial-cycle-${stamp}.txt`);
writeFileSync(reportPath, report + '\n', 'utf8');
writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n', 'utf8');
console.log(report);
console.log('Report:', reportPath);
