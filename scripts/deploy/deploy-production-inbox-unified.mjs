#!/usr/bin/env node
/**
 * Build + deploy Web (padrão) ou API+Web — inbox templates 24h + filtros.
 * Web-only: DEPLOY_SCOPE=web (API já em prod-profile-perms-*).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const repo = process.env.GCP_ARTIFACT_REPO || 'panel-services';
const scope = (process.env.DEPLOY_SCOPE || 'web').toLowerCase();
const webOnly = scope === 'web';
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Date.now()).slice(-4);
const tag = process.env.DEPLOY_TAG || `prod-inbox-unified-${stamp}`;

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

console.log('Deploy tag:', tag, webOnly ? '(web-only)' : '(api+web)');

if (!webOnly) {
  run(
    `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api.yaml --project=${project} --substitutions=${baseSub}`
  );
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
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-web.yaml --project=${project} --substitutions="${webSub}"`
);

run(`gcloud run services update flux-farma-web --project=${project} --region=${region} --image=${webImage}`);

if (!webOnly) {
  run(`gcloud run services update flux-farma-api --project=${project} --region=${region} --image=${apiImage}`);
  run(`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gcp/deploy-production-api.ps1`);
  run(`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gcp/deploy-production-workers-env.ps1`);
  run(`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gcp/post-deploy-pilot.ps1`);
}

const apiRev = webOnly ? '(unchanged)' : revision('flux-farma-api');
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
  '- Inbox: seletor Template Meta fora da janela 24h (mesma conversa)',
  '- Inbox: filtros supervisor/gestor (attendance_group × status) + pasta Todas as conversas (admin)',
  webOnly ? '- API: sem alteração (mantém revisão atual)' : '- Permissões: contatos, cadastros, relatórios por perfil',
  webOnly ? '' : '- OTP líder: template leader_otp',
  '',
  'Validação:',
  '- Inbox conversa fechada 24h: aba Template Meta + envio',
  '- Supervisor: filtros atendente + grupo atendimento',
  '- Admin: pasta Todas as conversas',
  webOnly ? '' : '- Atendentes: cadastrar contato (/contacts)',
  webOnly ? '' : '- Portal líder: OTP WhatsApp',
].join('\n');

const reportPath = path.join(repoRoot, 'reports', `deploy-inbox-unified-${stamp}.txt`);
writeFileSync(reportPath, report + '\n', 'utf8');
writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n', 'utf8');
console.log('\n' + report);
console.log('Report:', reportPath);
