#!/usr/bin/env node
/**
 * Build + deploy: api, orchestrator, web (CSAT parsing, dashboard KPIs, inbox polling, Pub/Sub ack).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const repo = 'panel-services';
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Date.now()).slice(-4);
const tag = `prod-csat-latency-${stamp}`;

const subs = JSON.parse(readFileSync(path.join(repoRoot, 'reports', 'web-build-substitutions.json'), 'utf8'));

const images = {
  api: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-api:${tag}`,
  orchestrator: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-orchestrator:${tag}`,
  web: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-web:${tag}-web`,
};

function run(cmd) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

const builds = [
  ['deploy/cloudbuild-flux-farma-api.yaml', `_TAG=${tag},_REGION=${region},_REPO=${repo}`],
  ['deploy/cloudbuild-flux-farma-orchestrator.yaml', `_TAG=${tag},_REGION=${region},_REPO=${repo}`],
];

for (const [config, substitution] of builds) {
  run(`gcloud builds submit . --config=${config} --project=${project} --substitutions=${substitution}`);
}

const webSub = [
  `_TAG=${tag}-web`,
  `_REGION=${region}`,
  `_REPO=${repo}`,
  `_NEXT_PUBLIC_API_URL=${subs.api}`,
  `_NEXT_PUBLIC_SUPABASE_URL=${subs.url}`,
  `_NEXT_PUBLIC_SUPABASE_ANON_KEY=${subs.anon}`,
].join(',');
run(`gcloud builds submit . --config=deploy/cloudbuild-flux-farma-web.yaml --project=${project} --substitutions="${webSub}"`);

const services = [
  ['flux-farma-api', images.api],
  ['flux-farma-orchestrator', images.orchestrator],
  ['flux-farma-web', images.web],
];

for (const [name, image] of services) {
  run(`gcloud run services update ${name} --project=${project} --region=${region} --image=${image}`);
}

const report = [
  `tag=${tag}`,
  ...Object.entries(images).map(([k, v]) => `${k}=${v}`),
  `deployed_at=${new Date().toISOString()}`,
  '',
].join('\n');

writeFileSync(path.join(repoRoot, 'reports', `deploy-csat-latency-${stamp}.txt`), report);
writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n');
console.log('\n' + report);
console.log('\nNext: npm run gcp:post-deploy:pilot');
