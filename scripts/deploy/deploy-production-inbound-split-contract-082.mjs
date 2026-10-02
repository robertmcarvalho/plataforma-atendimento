#!/usr/bin/env node
/**
 * Deploy produção: Opção B inbound split + migration 082 + merge contatos opcional.
 * 1. Pub/Sub bootstrap (whatsapp.inbound.auto)
 * 2. Build + deploy api, orchestrator, webhook, web
 * 3. Env orchestrator (PUBSUB_TOPIC/SUB inbound.auto)
 * 4. Migration 082
 * 5. post-deploy pilot
 *
 *   node scripts/deploy/deploy-production-inbound-split-contract-082.mjs
 *   node scripts/deploy/deploy-production-inbound-split-contract-082.mjs --merge-phone 96710044
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
const tag = process.env.DEPLOY_TAG || `prod-inbound-split-082-${stamp}`;
const mergePhone = process.argv.find((a) => a.startsWith('--merge-phone='))?.split('=')[1]
  || (process.argv.includes('--merge-phone') ? process.argv[process.argv.indexOf('--merge-phone') + 1] : null);

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

function run(cmd, opts = {}) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true, ...opts });
}

console.log('Deploy tag:', tag);

run(`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gcp/pubsub-bootstrap.ps1`, {
  env: { ...process.env, GCP_PROJECT_ID: project },
});

for (const [config, substitution] of [
  ['deploy/cloudbuild-flux-farma-api.yaml', `_TAG=${tag},_REGION=${region},_REPO=${repo}`],
  ['deploy/cloudbuild-flux-farma-orchestrator.yaml', `_TAG=${tag},_REGION=${region},_REPO=${repo}`],
  ['deploy/cloudbuild-flux-farma-webhook.yaml', `_TAG=${tag},_REGION=${region},_REPO=${repo}`],
]) {
  run(`gcloud builds submit . --config=${config} --project=${project} --substitutions=${substitution}`);
}

const orchEnv =
  'PUBSUB_TOPIC_INBOUND_AUTO=whatsapp.inbound.auto,PUBSUB_SUBSCRIPTION_INBOUND_AUTO=whatsapp.inbound.auto-sub';
run(
  `gcloud run services update flux-farma-orchestrator --project=${project} --region=${region} --update-env-vars=${orchEnv}`
);

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

process.env.CONFIRM_PRODUCTION_MIGRATION_082 = 'true';
run('node scripts/db/apply-migration-082-commercial-contract-onboarding.mjs --execute');

if (mergePhone) {
  run(`node scripts/one-off/merge-duplicate-wa-contacts-prod.mjs ${mergePhone} --execute`);
}

run('npm run gcp:post-deploy:pilot');

const report = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  ...Object.entries(images).map(([k, v]) => `${k}=${v}`),
  'scope=inbound-split-option-b+contract-onboarding-082+canonical-wa-phone',
  mergePhone ? `merge_phone=${mergePhone}` : '',
  '',
].join('\n');

const reportsDir = path.join(repoRoot, 'reports');
mkdirSync(reportsDir, { recursive: true });
writeFileSync(path.join(reportsDir, `deploy-inbound-split-082-${stamp}.txt`), report);
writeFileSync(path.join(reportsDir, 'last-deploy-tag.txt'), `${tag}\n`);
writeFileSync(path.join(repoRoot, '.deploy-tag.txt'), `${tag}\n`);
console.log('\n' + report);
