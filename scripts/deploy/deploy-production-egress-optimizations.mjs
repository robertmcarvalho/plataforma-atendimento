#!/usr/bin/env node
/**
 * Deploy API + Web + Scheduler + Orchestrator — otimizações de egress PostgREST:
 * inbox SSE único, polling condicional, cache patch, GET conversa sem duplicata,
 * comercial poll scoring, workers selects estreitos, flux sync incremental.
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
const tag = process.env.DEPLOY_TAG || `prod-egress-opt-${stamp}`;

const subs = JSON.parse(readFileSync(path.join(repoRoot, 'reports', 'web-build-substitutions.json'), 'utf8'));
if (!subs.url?.includes('omhlbavfsttwcnybzvcd')) {
  throw new Error('reports/web-build-substitutions.json deve apontar para omhlb (produção)');
}

const baseSub = `_TAG=${tag},_REGION=${region},_REPO=${repo}`;
const images = {
  api: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-api:${tag}`,
  web: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-web:${tag}-web`,
  scheduler: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-scheduler:${tag}`,
  orchestrator: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-orchestrator:${tag}`,
};

function run(cmd) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

function revision(service) {
  return execSync(
    `gcloud run services describe ${service} --project=${project} --region=${region} --format="value(status.latestReadyRevisionName)"`,
    { cwd: repoRoot, encoding: 'utf8' }
  ).trim();
}

console.log('Deploy tag:', tag);

run(`gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api.yaml --project=${project} --substitutions=${baseSub}`);
run(`gcloud builds submit . --config=deploy/cloudbuild-flux-farma-scheduler.yaml --project=${project} --substitutions=${baseSub}`);
run(`gcloud builds submit . --config=deploy/cloudbuild-flux-farma-orchestrator.yaml --project=${project} --substitutions=${baseSub}`);

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
run(`gcloud run services update flux-farma-orchestrator --project=${project} --region=${region} --image=${images.orchestrator}`);
run(`gcloud run services update flux-farma-web --project=${project} --region=${region} --image=${images.web}`);

run(`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gcp/deploy-production-api.ps1`);
run(`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gcp/deploy-production-workers-env.ps1`);
run(`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gcp/post-deploy-pilot.ps1`);

const report = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  `api_image=${images.api}`,
  `web_image=${images.web}`,
  `scheduler_image=${images.scheduler}`,
  `orchestrator_image=${images.orchestrator}`,
  `api_revision=${revision('flux-farma-api')}`,
  `web_revision=${revision('flux-farma-web')}`,
  `scheduler_revision=${revision('flux-farma-scheduler')}`,
  `orchestrator_revision=${revision('flux-farma-orchestrator')}`,
  '',
  'Otimizações:',
  '- Inbox: SSE único, polling 60s fallback, aba background pausada, append cache',
  '- API: GET /conversations/:id sem query duplicada',
  '- Comercial: poll 5s só com scoring pendente',
  '- Workers: selects estreitos, flux delivery sync incremental',
  '',
  'Validação:',
  '- Inbox: mensagem nova aparece sem refetch pesado (Network tab)',
  '- Supabase dashboard: queda de egress PostgREST nas próximas 24h',
].join('\n');

const reportPath = path.join(repoRoot, 'reports', `deploy-egress-opt-${stamp}.txt`);
writeFileSync(reportPath, report + '\n', 'utf8');
writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n', 'utf8');
console.log('\n' + report);
console.log('Report:', reportPath);
