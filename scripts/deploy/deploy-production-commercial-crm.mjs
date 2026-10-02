#!/usr/bin/env node
/**
 * Build + deploy API (CRM Comercial backend).
 * Aplique supabase/migrations/047_commercial_crm.sql no projeto Supabase antes do deploy.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const repo = process.env.GCP_ARTIFACT_REPO || 'panel-services';
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Date.now()).slice(-6);
const tag = process.env.DEPLOY_TAG || `prod-commercial-crm-${stamp}`;

const baseSub = `_TAG=${tag},_REGION=${region},_REPO=${repo}`;
const apiImage = `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-api:${tag}`;

function run(cmd) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

console.log('Deploy tag:', tag);
console.log('Lembrete: aplicar migration 047_commercial_crm.sql no Supabase antes de atualizar o Cloud Run.');

run(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api.yaml --project=${project} --substitutions=${baseSub}`,
);

run(`gcloud run services update flux-farma-api --project=${project} --region=${region} --image=${apiImage}`);

const report = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  `api_image=${apiImage}`,
  '',
  'Serviço: flux-farma-api',
  'Migration: supabase/migrations/047_commercial_crm.sql',
].join('\n');

writeFileSync(path.join(repoRoot, '.deploy-tag.txt'), tag + '\n', 'utf8');
writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n', 'utf8');
console.log('\n' + report);
