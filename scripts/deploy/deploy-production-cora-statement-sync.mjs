#!/usr/bin/env node
/**
 * Deploy Cora extrato/saldo sync MVP:
 * - Build + deploy flux-farma-api (+ scheduler para job proxy)
 * - Preserva env/secrets via deploy-production-api.ps1 (--update-secrets + env-vars-file)
 * - Flags SYNC_ENABLED / SYNC_WRITE ficam false no yaml até smoke
 *
 *   node scripts/deploy/deploy-production-cora-statement-sync.mjs
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const repo = process.env.GCP_ARTIFACT_REPO || 'panel-services';
const tag = process.env.IMAGE_TAG || `cora-stmt-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString(36)}`;
const baseSub = `_TAG=${tag},_REGION=${region},_REPO=${repo}`;

function run(cmd) {
  console.log('>', cmd);
  execSync(cmd, { stdio: 'inherit', env: process.env });
}

function revision(service) {
  return execSync(
    `gcloud run services describe ${service} --project=${project} --region=${region} --format=value(status.latestReadyRevisionName)`,
    { encoding: 'utf8' }
  ).trim();
}

const images = {
  api: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-api:${tag}`,
  scheduler: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-scheduler:${tag}`,
};

console.log(JSON.stringify({ project, region, tag, images }, null, 2));

run(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api.yaml --project=${project} --substitutions=${baseSub}`
);
run(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-scheduler.yaml --project=${project} --substitutions=${baseSub}`
);

run(`gcloud run services update flux-farma-api --project=${project} --region=${region} --image=${images.api}`);
run(
  `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gcp/deploy-production-api.ps1`
);

run(
  `gcloud run services update flux-farma-scheduler --project=${project} --region=${region} --image=${images.scheduler} --update-env-vars=API_SERVICE_URL=https://flux-farma-api-713561463013.us-central1.run.app`
);

// Cloud Scheduler job Mon–Fri 18:00 (não rotaciona token se já existir no report)
run(
  `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/gcp/setup-scheduler-cloud-scheduler.ps1`
);

const apiRev = revision('flux-farma-api');
const schRev = revision('flux-farma-scheduler');
const out = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  `api_image=${images.api}`,
  `api_revision=${apiRev}`,
  `scheduler_image=${images.scheduler}`,
  `scheduler_revision=${schRev}`,
  `BILLING_CORA_STATEMENT_SYNC_ENABLED=false`,
  `BILLING_CORA_STATEMENT_SYNC_WRITE=false`,
  `scheduler_job=flux-scheduler-cora-statement-sync`,
  `schedule=0 18 * * 1-5 America/Sao_Paulo`,
].join('\n');

writeFileSync(join('reports', 'deploy-cora-extrato-sync-revisions-2026-09-09.txt'), `${out}\n`);
console.log(out);
console.log('\nNext: post-deploy-pilot.ps1 + smoke dry_run');
