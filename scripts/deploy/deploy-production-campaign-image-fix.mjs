#!/usr/bin/env node
/**
 * Rebuild + deploy flux-farma-campaign (corrige ContainerImageImportFailed).
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
const tag = process.env.DEPLOY_TAG || `prod-campaign-fix-${stamp}`;

const image = `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-campaign:${tag}`;
const baseSub = `_TAG=${tag},_REGION=${region},_REPO=${repo}`;

function run(cmd) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

console.log('Deploy campaign image fix tag:', tag);

run(`gcloud builds submit . --config=deploy/cloudbuild-flux-farma-campaign.yaml --project=${project} --substitutions=${baseSub}`);
run(`gcloud run services update flux-farma-campaign --project=${project} --region=${region} --image=${image}`);
run(`powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:GCP_PROJECT_ID='${project}'; & scripts/gcp/post-deploy-pilot.ps1"`);

const rev = execSync(
  `gcloud run services describe flux-farma-campaign --project=${project} --region=${region} --format="value(status.latestReadyRevisionName)"`,
  { encoding: 'utf8' }
).trim();

const digest = execSync(
  `gcloud artifacts docker images list ${region}-docker.pkg.dev/${project}/${repo}/flux-farma-campaign --include-tags --filter="tags:${tag}" --format="value(version)"`,
  { encoding: 'utf8' }
).trim();

const reportPath = path.join(repoRoot, 'reports', `deploy-campaign-fix-${stamp}.txt`);
writeFileSync(
  reportPath,
  [
    `deployed_at=${new Date().toISOString()}`,
    `tag=${tag}`,
    `image=${image}`,
    `digest=${digest}`,
    `revision=${rev}`,
  ].join('\n') + '\n'
);
console.log('\nReport:', reportPath);
