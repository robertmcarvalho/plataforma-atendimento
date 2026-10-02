#!/usr/bin/env node
/**
 * Deploy API only — leader portal contact unique constraint fix.
 * Preserves Cloud Run env/secrets/mounts (image update only).
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const repo = process.env.GCP_ARTIFACT_REPO || 'panel-services';
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Date.now()).slice(-4);
const tag = process.env.DEPLOY_TAG || `prod-leader-contact-dup-${stamp}`;
const baseSub = `_TAG=${tag},_REGION=${region},_REPO=${repo}`;
const apiImage = `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-api:${tag}`;

function run(cmd) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

console.log('Deploy tag:', tag);
run(`gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api.yaml --project=${project} --substitutions=${baseSub}`);
run(`gcloud run services update flux-farma-api --project=${project} --region=${region} --image=${apiImage}`);
run(`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gcp/post-deploy-pilot.ps1`);

const revision = execSync(
  `gcloud run services describe flux-farma-api --project=${project} --region=${region} --format=value(status.latestReadyRevisionName)`,
  { cwd: repoRoot, encoding: 'utf8' }
).trim();

console.log(`\nOK api_image=${apiImage}`);
console.log(`OK revision=${revision}`);
