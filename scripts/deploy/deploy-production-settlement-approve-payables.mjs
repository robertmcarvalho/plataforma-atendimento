#!/usr/bin/env node
/**
 * Deploy flux-farma-api: gera APs ao aprovar acerto individual (não só approve-all).
 *
 *   node scripts/deploy/deploy-production-settlement-approve-payables.mjs
 */
import { execSync } from 'node:child_process';

const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const repo = process.env.GCP_ARTIFACT_REPO || 'panel-services';
const tag =
  process.env.IMAGE_TAG ||
  `settlement-approve-ap-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
const apiImage = `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-api:${tag}`;

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', env: process.env });
}

run(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api.yaml --project=${project} --substitutions=_TAG=${tag},_REGION=${region},_REPO=${repo}`
);
run(`gcloud run services update flux-farma-api --project=${project} --region=${region} --image=${apiImage}`);
run(
  `powershell -ExecutionPolicy Bypass -Command "$env:GCP_PROJECT_ID='${project}'; & .\\scripts\\gcp\\post-deploy-pilot.ps1"`
);

console.log(JSON.stringify({ ok: true, apiImage, project, region, tag }, null, 2));
