#!/usr/bin/env node
/**
 * Build + deploy API + web: Meta template picker filtrado por canal WhatsApp
 * (force-channel no envio + listagem por canal operacional/comercial).
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
const tag = `prod-meta-template-channel-${stamp}`;

const subs = JSON.parse(readFileSync(path.join(repoRoot, 'reports', 'web-build-substitutions.json'), 'utf8'));

const images = {
  api: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-api:${tag}`,
  web: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-web:${tag}-web`,
};

function run(cmd) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

console.log('Deploy tag:', tag);
run(`gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api.yaml --project=${project} --substitutions=_TAG=${tag},_REGION=${region},_REPO=${repo}`);

const webSub = [
  `_TAG=${tag}-web`,
  `_REGION=${region}`,
  `_REPO=${repo}`,
  `_NEXT_PUBLIC_API_URL=${subs.api}`,
  `_NEXT_PUBLIC_SUPABASE_URL=${subs.url}`,
  `_NEXT_PUBLIC_SUPABASE_ANON_KEY=${subs.anon}`,
].join(',');
run(`gcloud builds submit . --config=deploy/cloudbuild-flux-farma-web.yaml --project=${project} --substitutions="${webSub}"`);

for (const [name, image] of [
  ['flux-farma-api', images.api],
  ['flux-farma-web', images.web],
]) {
  run(`gcloud run services update ${name} --project=${project} --region=${region} --image=${image}`);
}

const report = [
  `tag=${tag}`,
  ...Object.entries(images).map(([k, v]) => `${k}=${v}`),
  `deployed_at=${new Date().toISOString()}`,
  '',
  'Pós-deploy obrigatório:',
  '  $env:GCP_PROJECT_ID = "rh-coopmob-bot"',
  '  .\\scripts\\gcp\\post-deploy-pilot.ps1',
  '',
].join('\n');
writeFileSync(path.join(repoRoot, 'reports', `deploy-meta-template-channel-${stamp}.txt`), report);
writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n');
console.log('\n' + report);
