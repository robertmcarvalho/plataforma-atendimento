#!/usr/bin/env node
/**
 * Build + deploy flux-farma-web com reports/web-build-substitutions.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const subs = JSON.parse(readFileSync(path.join(repoRoot, 'reports', 'web-build-substitutions.json'), 'utf8'));

if (!subs.url?.includes('omhlbavfsttwcnybzvcd')) {
  throw new Error('reports/web-build-substitutions.json deve apontar para omhlb (plataforma_atendimento)');
}
if (!subs.anon || subs.anon.length < 20) {
  throw new Error('anon key ausente em web-build-substitutions.json');
}

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Date.now()).slice(-4);
const tag = `prod-plataforma-atendimento-db-${stamp}-web`;
const image = `${region}-docker.pkg.dev/${project}/panel-services/flux-farma-web:${tag}`;

const substitutionPairs = {
  _TAG: tag,
  _REGION: region,
  _REPO: 'panel-services',
  _NEXT_PUBLIC_API_URL: subs.api,
  _NEXT_PUBLIC_SUPABASE_URL: subs.url,
  _NEXT_PUBLIC_SUPABASE_ANON_KEY: subs.anon,
};

const subArg = Object.entries(substitutionPairs)
  .map(([k, v]) => `${k}=${v}`)
  .join(',');

console.log('Building', image);
execSync(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-web.yaml --project=${project} --substitutions=${subArg}`,
  { cwd: repoRoot, stdio: 'inherit', shell: true }
);

console.log('Deploying flux-farma-web...');
execSync(
  `gcloud run services update flux-farma-web --project=${project} --region=${region} --image=${image}`,
  { stdio: 'inherit', shell: true }
);

const report = {
  tag,
  image,
  deployed_at: new Date().toISOString(),
  supabase_ref: 'omhlbavfsttwcnybzvcd',
};
writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n', 'utf8');
writeFileSync(
  path.join(repoRoot, 'reports', `deploy-prod-plataforma-atendimento-db-${stamp}.txt`),
  [
    'Cutover DB → plataforma_atendimento (omhlb)',
    `Tag: ${tag}`,
    `Image: ${image}`,
    `API URL build: ${subs.api}`,
    `Supabase URL build: ${subs.url}`,
    '',
  ].join('\n'),
  'utf8'
);
console.log(JSON.stringify(report, null, 2));
