#!/usr/bin/env node
/** Deploy API + Orchestrator — mídia WhatsApp inbound/outbound (web em deploy separado). */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const repo = process.env.GCP_ARTIFACT_REPO || 'panel-services';
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Date.now()).slice(-4);
const tag = process.env.DEPLOY_TAG || `prod-wa-media-${stamp}`;
const baseSub = `_TAG=${tag},_REGION=${region},_REPO=${repo}`;
const images = {
  api: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-api:${tag}`,
  orchestrator: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-orchestrator:${tag}`,
};

function run(cmd) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

console.log('Deploy tag:', tag);
run(`gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api.yaml --project=${project} --substitutions=${baseSub}`);
run(`gcloud builds submit . --config=deploy/cloudbuild-flux-farma-orchestrator.yaml --project=${project} --substitutions=${baseSub}`);
run(`gcloud run services update flux-farma-api --project=${project} --region=${region} --image=${images.api}`);

const orchSecrets = [
  'SUPABASE_URL=supabase-url:latest',
  'SUPABASE_SERVICE_ROLE_KEY=supabase-sr:latest',
  'META_ACCESS_TOKEN=meta-access-token:latest',
  'META_PHONE_NUMBER_ID=meta-phone-number-id:latest',
  'GOOGLE_API_KEY=google-api-key:latest',
  'INTEGRATIONS_ENCRYPTION_KEY=integrations-encryption-key:latest',
].join(',');
run(
  `gcloud run services update flux-farma-orchestrator --project=${project} --region=${region} --image=${images.orchestrator} --set-secrets=${orchSecrets} --remove-env-vars=SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,META_ACCESS_TOKEN,META_PHONE_NUMBER_ID,GOOGLE_API_KEY,INTEGRATIONS_ENCRYPTION_KEY`
);
run(
  `gcloud pubsub subscriptions update whatsapp.inbound.auto-sub --project=${project} --ack-deadline=300`
);

const report = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  `api_image=${images.api}`,
  `orchestrator_image=${images.orchestrator}`,
  '',
  'Pós-deploy:',
  '- Testar gravação de áudio na inbox (webm → ogg na API)',
  '- Cliente reenvia imagem/áudio → deve aparecer com media_url (mídias antigas sem URL não recuperam)',
  '- node scripts/one-off/audit-inbound-media-prod.mjs',
  '- INTEGRATIONS_ENCRYPTION_KEY no orchestrator + enrich na fase persist',
  '- Web (UI placeholders/ogg): deploy/cloudbuild-flux-farma-web.yaml separado',
].join('\n');
const reportPath = path.join(repoRoot, 'reports', `deploy-wa-media-${stamp}.txt`);
writeFileSync(reportPath, report + '\n', 'utf8');
writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n', 'utf8');
console.log('\n' + report);
console.log('\nReport:', reportPath);
