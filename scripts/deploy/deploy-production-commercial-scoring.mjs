#!/usr/bin/env node
/**
 * Build + deploy API, orchestrator, scheduler e Web:
 * - Scoring comercial Gemini (ai-core) + dedupe telefone lead
 * - UI Calculando… / badge IA
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const repo = process.env.GCP_ARTIFACT_REPO || 'panel-services';
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Date.now()).slice(-4);
const tag = process.env.DEPLOY_TAG || `prod-commercial-scoring-${stamp}`;

const subs = JSON.parse(readFileSync(path.join(repoRoot, 'reports', 'web-build-substitutions.json'), 'utf8'));
if (!subs.url?.includes('omhlbavfsttwcnybzvcd')) {
  throw new Error('reports/web-build-substitutions.json deve apontar para omhlb');
}

const baseSub = `_TAG=${tag},_REGION=${region},_REPO=${repo}`;
const images = {
  api: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-api:${tag}`,
  orchestrator: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-orchestrator:${tag}`,
  scheduler: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-scheduler:${tag}`,
  web: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-web:${tag}-web`,
};

function run(cmd) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

console.log('Deploy tag:', tag);

for (const config of [
  'deploy/cloudbuild-flux-farma-api.yaml',
  'deploy/cloudbuild-flux-farma-orchestrator.yaml',
  'deploy/cloudbuild-flux-farma-scheduler.yaml',
]) {
  run(`gcloud builds submit . --config=${config} --project=${project} --substitutions=${baseSub}`);
}

const webSub = [
  `_TAG=${tag}-web`,
  `_REGION=${region}`,
  `_REPO=${repo}`,
  `_NEXT_PUBLIC_API_URL=${subs.api}`,
  `_NEXT_PUBLIC_SUPABASE_URL=${subs.url}`,
  `_NEXT_PUBLIC_SUPABASE_ANON_KEY=${subs.anon}`,
].join(',');

run(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-web.yaml --project=${project} --substitutions="${webSub}"`,
);

for (const [name, image] of [
  ['flux-farma-api', images.api],
  ['flux-farma-orchestrator', images.orchestrator],
  ['flux-farma-scheduler', images.scheduler],
  ['flux-farma-web', images.web],
]) {
  run(`gcloud run services update ${name} --project=${project} --region=${region} --image=${image}`);
}

const report = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  ...Object.entries(images).map(([k, v]) => `${k}=${v}`),
  '',
  'Pré-requisito DB:',
  '- CONFIRM_PRODUCTION_MIGRATION_090=true node scripts/db/apply-migration-090-commercial-lead-scoring.mjs --execute',
  '',
  'Pós-deploy:',
  '- npm run gcp:post-deploy:pilot',
].join('\n');

const reportsDir = path.join(repoRoot, 'reports');
mkdirSync(reportsDir, { recursive: true });
const reportPath = path.join(reportsDir, `deploy-commercial-scoring-${stamp}.txt`);
writeFileSync(reportPath, report + '\n', 'utf8');
writeFileSync(path.join(reportsDir, 'last-deploy-tag.txt'), tag + '\n', 'utf8');
console.log('\n' + report);
console.log('Report:', reportPath);
console.log('\nNext: npm run gcp:post-deploy:pilot');
