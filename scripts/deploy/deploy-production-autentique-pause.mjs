#!/usr/bin/env node
/** Deploy API + Scheduler — pausa Autentique (AUTENTIQUE_SYNC_ENABLED=false). */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const repo = process.env.GCP_ARTIFACT_REPO || 'panel-services';
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Date.now()).slice(-4);
const tag = process.env.DEPLOY_TAG || `prod-autentique-pause-${stamp}`;

const baseSub = `_TAG=${tag},_REGION=${region},_REPO=${repo}`;
const images = {
  api: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-api:${tag}`,
  scheduler: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-scheduler:${tag}`,
};

function run(cmd) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

console.log('Deploy tag:', tag);
run(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api.yaml --project=${project} --substitutions=${baseSub}`,
);
run(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-scheduler.yaml --project=${project} --substitutions=${baseSub}`,
);
run(`gcloud run services update flux-farma-api --project=${project} --region=${region} --image=${images.api} --update-env-vars=AUTENTIQUE_SYNC_ENABLED=false`);
run(`gcloud run services update flux-farma-scheduler --project=${project} --region=${region} --image=${images.scheduler} --update-env-vars=AUTENTIQUE_SYNC_ENABLED=false`);
writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n', 'utf8');
console.log('\nAutentique pausado. Para retomar: AUTENTIQUE_SYNC_ENABLED=true + reativar job flux-scheduler-signature-sync');
