#!/usr/bin/env node
/**
 * Deploy API + Web — pacote pendente:
 * - Busca remota de entregadores (tarefas, desligamento, ocorrências)
 * - Formulários tarefa manual (matrícula/desligamento) alinhados ao líder
 * - MessageBubble preview/download mídia
 * - Inbox áudio (conversation_id multipart, parar e enviar)
 * - Metadata tarefas (last_worked_at, operation_started_at, reason, leader)
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
const tag = process.env.DEPLOY_TAG || `prod-ops-forms-driver-search-${stamp}`;

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

const report = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  `api_image=${apiImage}`,
  `web_image=${webImage}`,
  '',
  'Inclui:',
  '- GET /api/ops-analytics/drivers/search (busca entregador em tarefas)',
  '- Formulários gerar matrícula/desligamento + solicitar desligamento',
  '- Ocorrências analista/financeiro com busca remota',
  '- MessageBubble preview/download mídia no chat',
  '- Inbox áudio (conversation_id + parar e enviar)',
  '- Metadata tarefas ciclo (último dia, início, motivo, líder)',
  '',
  'Validação:',
  '- AG: Nova tarefa → Gerar termo desligamento → buscar ROONEY / VALDIR',
  '- Inbox: gravar áudio e enviar; imagem/PDF com preview',
  '- Carteira: ocorrência e solicitar desligamento com busca',
].join('\n');

const reportPath = path.join(repoRoot, 'reports', `deploy-ops-forms-driver-search-${stamp}.txt`);
writeFileSync(reportPath, report + '\n', 'utf8');
writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n', 'utf8');
console.log('\n' + report);
console.log('Report:', reportPath);
