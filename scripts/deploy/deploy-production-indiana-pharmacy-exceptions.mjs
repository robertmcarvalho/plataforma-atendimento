#!/usr/bin/env node
/**
 * Deploy flux-farma-api with Indiana LJ 06/19 pharmacy key exceptions, then post-deploy pilot.
 *
 *   node scripts/deploy/deploy-production-indiana-pharmacy-exceptions.mjs
 */
import { execSync } from 'node:child_process';

const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const repo = process.env.GCP_ARTIFACT_REPO || 'panel-services';
const tag = process.env.IMAGE_TAG || `indiana-exc-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
const apiImage = `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-api:${tag}`;

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', env: process.env });
}

run(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api.yaml --project=${project} --substitutions=_TAG=${tag},_REGION=${region},_REPO=${repo}`
);
run(`gcloud run services update flux-farma-api --project=${project} --region=${region} --image=${apiImage}`);
run(`powershell -ExecutionPolicy Bypass -File scripts/gcp/post-deploy-pilot.ps1`);

console.log(JSON.stringify({ ok: true, apiImage, project, region }, null, 2));
