#!/usr/bin/env node
/**
 * Build + deploy completo para prospecção comercial e pendências correlatas:
 * - API: validação 24h em /messages/send, conversations/start commercial_lead + primary_conversation_id
 * - Orchestrator: bot comercial (commercialBotRuntime), roteamento outbound por phone_number_id
 * - Webhook: imagem alinhada ao pipeline inbound
 * - Web: modal Iniciar prospecção na ficha do lead
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
const tag = process.env.DEPLOY_TAG || `prod-commercial-prospection-${stamp}`;

const subs = JSON.parse(readFileSync(path.join(repoRoot, 'reports', 'web-build-substitutions.json'), 'utf8'));
if (!subs.url?.includes('omhlbavfsttwcnybzvcd')) {
  throw new Error('reports/web-build-substitutions.json deve apontar para omhlb (produção).');
}

const images = {
  api: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-api:${tag}`,
  orchestrator: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-orchestrator:${tag}`,
  webhook: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-webhook:${tag}`,
  web: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-web:${tag}-web`,
};

function run(cmd) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

console.log('Deploy tag:', tag);

for (const [config, substitution] of [
  ['deploy/cloudbuild-flux-farma-api.yaml', `_TAG=${tag},_REGION=${region},_REPO=${repo}`],
  ['deploy/cloudbuild-flux-farma-orchestrator.yaml', `_TAG=${tag},_REGION=${region},_REPO=${repo}`],
  ['deploy/cloudbuild-flux-farma-webhook.yaml', `_TAG=${tag},_REGION=${region},_REPO=${repo}`],
]) {
  run(`gcloud builds submit . --config=${config} --project=${project} --substitutions=${substitution}`);
}

const webSub = [
  `_TAG=${tag}-web`,
  `_REGION=${region}`,
  `_REPO=${repo}`,
  `_NEXT_PUBLIC_API_URL=${subs.api}`,
  `_NEXT_PUBLIC_SUPABASE_URL=${subs.url}`,
  `_NEXT_PUBLIC_SUPABASE_ANON_KEY=${subs.anon}`,
].join(',');
run(`gcloud builds submit . --config=deploy/cloudbuild-flux-farma-web.yaml --project=${project} --substitutions="${webSub}"`);

for (const [name, image] of [
  ['flux-farma-api', images.api],
  ['flux-farma-orchestrator', images.orchestrator],
  ['flux-farma-webhook', images.webhook],
  ['flux-farma-web', images.web],
]) {
  run(`gcloud run services update ${name} --project=${project} --region=${region} --image=${image}`);
}

const report = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  ...Object.entries(images).map(([k, v]) => `${k}=${v}`),
  'scope=api+orchestrator+webhook+web (commercial prospection + pending inbox/commercial fixes)',
  '',
].join('\n');

const reportsDir = path.join(repoRoot, 'reports');
mkdirSync(reportsDir, { recursive: true });
writeFileSync(path.join(reportsDir, `deploy-commercial-prospection-${stamp}.txt`), report);
writeFileSync(path.join(reportsDir, 'last-deploy-tag.txt'), `${tag}\n`);
writeFileSync(path.join(repoRoot, '.deploy-tag.txt'), `${tag}\n`);
console.log('\n' + report);
console.log('\nNext: npm run gcp:post-deploy:pilot');
