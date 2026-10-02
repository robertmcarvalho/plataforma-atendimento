#!/usr/bin/env node
/**
 * Build + deploy API e Web — permissões por perfil (contatos, cadastros, relatórios).
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
const tag = process.env.DEPLOY_TAG || `prod-profile-perms-${stamp}`;

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

// API env (OTP template name + demais vars do yaml)
run(`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gcp/deploy-production-api.ps1`);

// Workers: novo meta-access-token + scaling piloto
run(`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gcp/deploy-production-workers-env.ps1`);
run(`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gcp/post-deploy-pilot.ps1`);

const report = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  `api_image=${apiImage}`,
  `web_image=${webImage}`,
  '',
  'Correções:',
  '- requireContactsManage (attendant + contacts.manage)',
  '- requireReportsView (reports.view no perfil)',
  '- requireCadastroManage: supervisor/financial',
  '- UI contatos + catálogo contacts no perfil',
  '- LEADER_WHATSAPP_OTP_TEMPLATE_NAME=leader_otp (via deploy-production-api.ps1)',
  '',
  'Validação:',
  '- Atendentes: cadastrar contato em /contacts',
  '- Logout/login após mudança de permissões no perfil',
].join('\n');

const reportPath = path.join(repoRoot, 'reports', `deploy-profile-perms-${stamp}.txt`);
writeFileSync(reportPath, report + '\n', 'utf8');
writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n', 'utf8');
console.log('\n' + report);
console.log('Report:', reportPath);
