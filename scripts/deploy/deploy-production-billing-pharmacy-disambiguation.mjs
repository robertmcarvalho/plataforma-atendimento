#!/usr/bin/env node
/**
 * Deploy flux-farma-api + web with delivery pharmacy disambiguation and acerto badge.
 *
 *   node scripts/deploy/deploy-production-billing-pharmacy-disambiguation.mjs
 */
import { execSync } from 'node:child_process';
import { loadProductionWebEnv } from '../lib/loadProdEnv.mjs';

const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const repo = process.env.GCP_ARTIFACT_REPO || 'panel-services';
const tag = process.env.IMAGE_TAG || `pharm-disambig-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;
const apiImage = `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-api:${tag}`;
const webImage = `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-web:${tag}`;

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', env: process.env });
}

const subs = loadProductionWebEnv(process.cwd());
run(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api.yaml --project=${project} --substitutions=_TAG=${tag},_REGION=${region},_REPO=${repo}`
);
run(`gcloud run services update flux-farma-api --project=${project} --region=${region} --image=${apiImage}`);

run(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-web.yaml --project=${project} --substitutions=_TAG=${tag},_REGION=${region},_REPO=${repo},_NEXT_PUBLIC_SUPABASE_URL=${subs.url},_NEXT_PUBLIC_SUPABASE_ANON_KEY=${subs.anonKey}`
);
run(`gcloud run services update flux-farma-web --project=${project} --region=${region} --image=${webImage}`);

run(`powershell -ExecutionPolicy Bypass -File scripts/gcp/post-deploy-pilot.ps1`);

console.log(JSON.stringify({ ok: true, apiImage, webImage, project, region }, null, 2));
