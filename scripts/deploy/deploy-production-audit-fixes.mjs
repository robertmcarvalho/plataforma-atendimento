#!/usr/bin/env node
/**
 * Deploy API + Web + Orchestrator — correções auditoria:
 * pendências, inbox/setores, comercial settings, nome entregador, nova tarefa AG.
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
const tag = process.env.DEPLOY_TAG || `prod-audit-fixes-${stamp}`;

const subs = JSON.parse(readFileSync(path.join(repoRoot, 'reports', 'web-build-substitutions.json'), 'utf8'));
if (!subs.url?.includes('omhlbavfsttwcnybzvcd')) {
  throw new Error('reports/web-build-substitutions.json deve apontar para omhlb (produção)');
}

const baseSub = `_TAG=${tag},_REGION=${region},_REPO=${repo}`;
const images = {
  api: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-api:${tag}`,
  web: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-web:${tag}-web`,
  orchestrator: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-orchestrator:${tag}`,
};

function run(cmd) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

console.log('Deploy tag:', tag);

run(`gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api.yaml --project=${project} --substitutions=${baseSub}`);
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
run(`gcloud run services update flux-farma-orchestrator --project=${project} --region=${region} --image=${images.orchestrator}`);
run(`gcloud run services update flux-farma-web --project=${project} --region=${region} --image=${images.web}`);

const report = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  `api_image=${images.api}`,
  `orchestrator_image=${images.orchestrator}`,
  `web_image=${images.web}`,
  '',
  'Validação pós-deploy:',
  '- Logout/login dos atendentes (JWT setores)',
  '- Config comercial: digitar ERP/motivo/campo',
  '- Inbox: nome entregador no cabeçalho',
  '- Luiz → Operação → Nova tarefa',
  '- Vendas → inbox → Todos do comercial',
  '- Albert não vê demanda financeira na inbox operacional',
].join('\n');

const reportPath = path.join(repoRoot, 'reports', `deploy-audit-fixes-${stamp}.txt`);
writeFileSync(reportPath, report + '\n', 'utf8');
writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n', 'utf8');
console.log('\n' + report);
console.log('Report:', reportPath);
