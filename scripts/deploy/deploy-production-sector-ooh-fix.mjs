#!/usr/bin/env node
/**
 * Build + deploy orchestrator — OOH setor financeiro (triagem + fila sem atendente).
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
const tag = process.env.DEPLOY_TAG || `prod-sector-ooh-fix-${stamp}`;
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
  '- Mensagem fora do horário ao escolher setor fechado (ex. Financeiro após 18h)',
  '- Sem atribuição de atendente quando setor fechado',
].join('\n');
const reportPath = path.join(repoRoot, 'reports', `deploy-sector-ooh-fix-${stamp}.txt`);
writeFileSync(reportPath, report + '\n', 'utf8');
writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n', 'utf8');
console.log('\n' + report);
console.log('Report:', reportPath);
console.log('\nNext: npm run gcp:post-deploy:pilot');
