#!/usr/bin/env node
/**
 * Deploy API + scheduler + Web — mapeamento coop (Gustavo), ciclo único, alertas acerto.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const repo = process.env.GCP_ARTIFACT_REPO || 'panel-services';
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Date.now()).slice(-4);
const tag = process.env.DEPLOY_TAG || `prod-signature-coop-fix-${stamp}`;
const coopEmail = process.env.AUTENTIQUE_COOP_EMAIL || 'gustavo.rezende@rezendeas.com.br';

const subs = JSON.parse(readFileSync(path.join(repoRoot, 'reports', 'web-build-substitutions.json'), 'utf8'));
if (!subs.url?.includes('omhlbavfsttwcnybzvcd')) {
  throw new Error('reports/web-build-substitutions.json deve apontar para omhlb (produção)');
}

const baseSub = `_TAG=${tag},_REGION=${region},_REPO=${repo}`;
const images = {
  api: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-api:${tag}`,
  scheduler: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-scheduler:${tag}`,
  web: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-web:${tag}-web`,
};

function run(cmd) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

console.log('Deploy tag:', tag);

run(`gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api.yaml --project=${project} --substitutions=${baseSub}`);
run(`gcloud builds submit . --config=deploy/cloudbuild-flux-farma-scheduler.yaml --project=${project} --substitutions=${baseSub}`);

const webSub = [
  `_TAG=${tag}-web`,
  `_REGION=${region}`,
  `_REPO=${repo}`,
  `_NEXT_PUBLIC_API_URL=${subs.api}`,
  `_NEXT_PUBLIC_SUPABASE_URL=${subs.url}`,
  `_NEXT_PUBLIC_SUPABASE_ANON_KEY=${subs.anon}`,
].join(',');

run(`gcloud builds submit . --config=deploy/cloudbuild-flux-farma-web.yaml --project=${project} --substitutions="${webSub}"`);

run(`gcloud run services update flux-farma-api --project=${project} --region=${region} --image=${images.api}`);
run(`gcloud run services update flux-farma-scheduler --project=${project} --region=${region} --image=${images.scheduler}`);
run(`gcloud run services update flux-farma-web --project=${project} --region=${region} --image=${images.web}`);

const envUpdate = `AUTENTIQUE_COOP_EMAIL=${coopEmail}`;
run(
  `gcloud run services update flux-farma-api --project=${project} --region=${region} --update-env-vars=${envUpdate}`
);
run(
  `gcloud run services update flux-farma-scheduler --project=${project} --region=${region} --update-env-vars=${envUpdate}`
);

const report = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  `api_image=${images.api}`,
  `scheduler_image=${images.scheduler}`,
  `web_image=${images.web}`,
  `AUTENTIQUE_COOP_EMAIL=${coopEmail}`,
  '',
  'Pós-deploy:',
  '  node scripts/one-off/reconcile-signatures-prod.mjs',
].join('\n');

const reportPath = path.join(repoRoot, 'reports', `deploy-signature-coop-fix-${stamp}.txt`);
writeFileSync(reportPath, report + '\n', 'utf8');
writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n', 'utf8');
console.log('\n' + report);
console.log('Report:', reportPath);
