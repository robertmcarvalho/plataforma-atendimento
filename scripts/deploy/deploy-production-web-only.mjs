#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const repo = 'panel-services';
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Date.now()).slice(-4);
const tag = `prod-web-only-${stamp}`;
const subs = JSON.parse(readFileSync(path.join(repoRoot, 'reports', 'web-build-substitutions.json'), 'utf8'));
const image = `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-web:${tag}-web`;

function run(cmd) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

const webSub = [
  `_TAG=${tag}-web`,
  `_REGION=${region}`,
  `_REPO=${repo}`,
  `_NEXT_PUBLIC_API_URL=${subs.api}`,
  `_NEXT_PUBLIC_SUPABASE_URL=${subs.url}`,
  `_NEXT_PUBLIC_SUPABASE_ANON_KEY=${subs.anon}`,
  `_NEXT_PUBLIC_BILLING_MODULE_ENABLED=true`,
].join(',');
run(`gcloud builds submit . --config=deploy/cloudbuild-flux-farma-web.yaml --project=${project} --substitutions="${webSub}"`);
run(`gcloud run services update flux-farma-web --project=${project} --region=${region} --image=${image}`);
writeFileSync(path.join(repoRoot, 'reports', `deploy-web-only-${stamp}.txt`), `tag=${tag}\nweb=${image}\n`);
