#!/usr/bin/env node
/** Deploy orchestrator: CSAT inbound (channel-runtime + flux-farma-orchestrator). */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const repo = process.env.GCP_ARTIFACT_REPO || 'panel-services';
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Date.now()).slice(-4);
const tag = process.env.DEPLOY_TAG || `prod-csat-inbound-fix-${stamp}`;
const baseSub = `_TAG=${tag},_REGION=${region},_REPO=${repo}`;
const orchestratorImage = `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-orchestrator:${tag}`;

function run(cmd) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

console.log('Deploy tag:', tag);
run(`gcloud builds submit . --config=deploy/cloudbuild-flux-farma-orchestrator.yaml --project=${project} --substitutions=${baseSub}`);
run(`gcloud run services update flux-farma-orchestrator --project=${project} --region=${region} --image=${orchestratorImage}`);

const revisionOut = execSync(
  `gcloud run services describe flux-farma-orchestrator --project=${project} --region=${region} --format=value(status.latestReadyRevisionName)`,
  { cwd: repoRoot, encoding: 'utf8', shell: true }
).trim();

const report = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  `orchestrator_image=${orchestratorImage}`,
  `orchestrator_revision=${revisionOut}`,
  'scope=csat-inbound-fix',
  '',
].join('\n');

const reportsDir = path.join(repoRoot, 'reports');
mkdirSync(reportsDir, { recursive: true });
writeFileSync(path.join(reportsDir, `deploy-csat-inbound-fix-${stamp}.txt`), report + '\n', 'utf8');
writeFileSync(path.join(reportsDir, 'last-deploy-tag.txt'), `${tag}\n`, 'utf8');
console.log('\n' + report);
