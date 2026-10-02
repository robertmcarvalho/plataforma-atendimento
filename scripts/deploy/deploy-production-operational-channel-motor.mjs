#!/usr/bin/env node
/**
 * Build + deploy orchestrator — OOH/fila pelo motor do canal (channel.config).
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const repo = process.env.GCP_ARTIFACT_REPO || 'panel-services';
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Date.now()).slice(-4);
const tag = process.env.DEPLOY_TAG || `prod-operational-channel-motor-${stamp}`;
const baseSub = `_TAG=${tag},_REGION=${region},_REPO=${repo}`;
const orchImage = `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-orchestrator:${tag}`;

function run(cmd) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

console.log('Deploy tag:', tag);
run(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-orchestrator.yaml --project=${project} --substitutions=${baseSub}`,
);
run(`gcloud run services update flux-farma-orchestrator --project=${project} --region=${region} --image=${orchImage}`);

const report = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  `orchestrator_image=${orchImage}`,
  '',
  'Validação:',
  '- OOH na 1ª mensagem inbound (fora do horário do canal)',
  '- queue_full ao entrar na fila sem atendente (dentro do horário)',
  '- Rodar: node scripts/one-off/sync-operational-channel-motor-prod.mjs --execute',
].join('\n');
const reportPath = path.join(repoRoot, 'reports', `deploy-operational-channel-motor-${stamp}.txt`);
writeFileSync(reportPath, report + '\n', 'utf8');
writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n', 'utf8');
console.log('\n' + report);
console.log('Report:', reportPath);
console.log('\nNext: npm run gcp:post-deploy:pilot');
