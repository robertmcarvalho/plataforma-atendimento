#!/usr/bin/env node
/**
 * Deploy API (+ scheduler) so Flux delivery sync links open billing cycles after import.
 *
 *   node scripts/deploy/deploy-production-billing-delivery-cycle-link.mjs
 */
import { execSync } from 'node:child_process';

const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const repo = process.env.GCP_ARTIFACT_REPO || 'panel-services';
const tag =
  process.env.IMAGE_TAG ||
  `billing-cycle-link-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
const apiImage = `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-api:${tag}`;
const schedulerImage = `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-scheduler:${tag}`;

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', env: process.env });
}

run(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api.yaml --project=${project} --substitutions=_TAG=${tag},_REGION=${region},_REPO=${repo}`
);
run(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-scheduler.yaml --project=${project} --substitutions=_TAG=${tag},_REGION=${region},_REPO=${repo}`
);
run(`gcloud run services update flux-farma-api --project=${project} --region=${region} --image=${apiImage}`);
run(
  `gcloud run services update flux-farma-scheduler --project=${project} --region=${region} --image=${schedulerImage}`
);
run(
  `powershell -ExecutionPolicy Bypass -Command "$env:GCP_PROJECT_ID='${project}'; & .\\scripts\\gcp\\post-deploy-pilot.ps1"`
);

console.log(JSON.stringify({ ok: true, apiImage, schedulerImage, project, region }, null, 2));
