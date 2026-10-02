#!/usr/bin/env node
/**
 * Build + deploy API e Web — toggle feriados no delivery comercial.
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
const tag = process.env.DEPLOY_TAG || `prod-lead-delivery-feriados-${stamp}`;

const subs = JSON.parse(readFileSync(path.join(repoRoot, 'reports', 'web-build-substitutions.json'), 'utf8'));
if (!subs.url?.includes('omhlbavfsttwcnybzvcd')) {
  throw new Error('reports/web-build-substitutions.json deve apontar para omhlb');
}

const baseSub = `_TAG=${tag},_REGION=${region},_REPO=${repo}`;
const apiImage = `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-api:${tag}`;
const webImage = `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-web:${tag}-web`;

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

run(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api.yaml --project=${project} --substitutions=${baseSub}`
);

const webSub = [
  `_TAG=${tag}-web`,
  `_REGION=${region}`,
  `_REPO=${repo}`,
  `_NEXT_PUBLIC_API_URL=${subs.api}`,
  `_NEXT_PUBLIC_SUPABASE_URL=${subs.url}`,
  `_NEXT_PUBLIC_SUPABASE_ANON_KEY=${subs.anon}`,
].join(',');

run(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-web.yaml --project=${project} --substitutions="${webSub}"`
);

run(`gcloud run services update flux-farma-api --project=${project} --region=${region} --image=${apiImage}`);
run(`gcloud run services update flux-farma-web --project=${project} --region=${region} --image=${webImage}`);

// API env sync (sem workers — só API+Web)
run(`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gcp/deploy-production-api.ps1`);

const apiRev = revision('flux-farma-api');
const webRev = revision('flux-farma-web');

const report = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  `api_image=${apiImage}`,
  `web_image=${webImage}`,
  `api_revision=${apiRev}`,
  `web_revision=${webRev}`,
  '',
  'Correções:',
  '- Toggle "Funcionamento do delivery em feriados" no lead comercial',
  '- Horários de feriados persistidos (delivery_feriados, horario_feriados_*)',
  '- Proposta PDF/DOCX: FER exibe horário ou "Fechado ao delivery"',
  '- Dimensionamento: delivery_funciona_feriados respeitado',
  '',
  'Validação:',
  '- Lead comercial: ativar/desativar toggle feriados + salvar',
  '- Gerar proposta: campo FER reflete toggle',
  '- Dimensionamento operacional com feriados ligado/desligado',
].join('\n');

const reportPath = path.join(repoRoot, 'reports', `deploy-lead-delivery-feriados-${stamp}.txt`);
writeFileSync(reportPath, report + '\n', 'utf8');
writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n', 'utf8');
console.log('\n' + report);
console.log('Report:', reportPath);
