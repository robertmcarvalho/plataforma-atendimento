#!/usr/bin/env node
/**
 * Deploy flux-farma-scheduler — Cloud Scheduler HTTP jobs + min=0 + night mode 22-06.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const repo = process.env.GCP_ARTIFACT_REPO || 'panel-services';
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Date.now()).slice(-4);
const tag = process.env.DEPLOY_TAG || `prod-cloud-scheduler-${stamp}`;

const image = `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-scheduler:${tag}`;
const baseSub = `_TAG=${tag},_REGION=${region},_REPO=${repo}`;

function run(cmd) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

console.log('Deploy scheduler Cloud Scheduler mode tag:', tag);

run(`gcloud builds submit . --config=deploy/cloudbuild-flux-farma-scheduler.yaml --project=${project} --substitutions=${baseSub}`);
run(`gcloud run services update flux-farma-scheduler --project=${project} --region=${region} --image=${image}`);

const tokenEnv = process.env.SCHEDULER_JOB_TOKEN ? `$env:SCHEDULER_JOB_TOKEN='${process.env.SCHEDULER_JOB_TOKEN}'; ` : '';
run(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${tokenEnv}$env:GCP_PROJECT_ID='${project}'; & scripts/gcp/setup-scheduler-cloud-scheduler.ps1"`);
run(`powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:GCP_PROJECT_ID='${project}'; & scripts/gcp/configure-orchestrator-night-mode.ps1"`);
run(`powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:GCP_PROJECT_ID='${project}'; & scripts/gcp/post-deploy-pilot.ps1"`);

const rev = execSync(
  `gcloud run services describe flux-farma-scheduler --project=${project} --region=${region} --format="value(status.latestReadyRevisionName)"`,
  { encoding: 'utf8' }
).trim();

mkdirSync(path.join(repoRoot, 'reports'), { recursive: true });
const tokenPath = path.join(repoRoot, 'reports', `scheduler-job-token-${stamp}.txt`);
if (process.env.SCHEDULER_JOB_TOKEN) {
  writeFileSync(tokenPath, `token_source=env\n`);
} else {
  writeFileSync(tokenPath, `token_source=generated_on_setup\nnote=Re-run setup with SCHEDULER_JOB_TOKEN if token was shown in console\n`);
}

const reportPath = path.join(repoRoot, 'reports', `deploy-cloud-scheduler-${stamp}.txt`);
writeFileSync(
  reportPath,
  [
    `deployed_at=${new Date().toISOString()}`,
    `tag=${tag}`,
    `image=${image}`,
    `revision=${rev}`,
    `mode=cloud_scheduler`,
  ].join('\n') + '\n'
);
console.log('\nReport:', reportPath);
