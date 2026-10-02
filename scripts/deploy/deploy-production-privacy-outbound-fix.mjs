#!/usr/bin/env node
/**
 * Deploy: página /public/privacidade (Meta Ao vivo) + correções outbound orchestrator.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const repo = process.env.GCP_ARTIFACT_REPO || 'panel-services';
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Date.now()).slice(-4);
const tag = process.env.DEPLOY_TAG || `prod-privacy-outbound-${stamp}`;

const subs = JSON.parse(readFileSync(path.join(repoRoot, 'reports', 'web-build-substitutions.json'), 'utf8'));

const images = {
  orchestrator: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-orchestrator:${tag}`,
  web: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-web:${tag}-web`,
};

function run(cmd) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

console.log('Deploy tag:', tag);

run(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-orchestrator.yaml --project=${project} --substitutions=_TAG=${tag},_REGION=${region},_REPO=${repo}`
);

const webSub = [
  `_TAG=${tag}-web`,
  `_REGION=${region}`,
  `_REPO=${repo}`,
  `_NEXT_PUBLIC_API_URL=${subs.api}`,
  `_NEXT_PUBLIC_SUPABASE_URL=${subs.url}`,
  `_NEXT_PUBLIC_SUPABASE_ANON_KEY=${subs.anon}`,
].join(',');
run(`gcloud builds submit . --config=deploy/cloudbuild-flux-farma-web.yaml --project=${project} --substitutions="${webSub}"`);

run(`gcloud run services update flux-farma-orchestrator --project=${project} --region=${region} --image=${images.orchestrator}`);
run(`gcloud run services update flux-farma-web --project=${project} --region=${region} --image=${images.web}`);

run('npm run gcp:post-deploy:pilot', {
  env: { ...process.env, GCP_PROJECT_ID: project },
});

const privacyUrl = 'https://flux-farma-web-713561463013.us-central1.run.app/public/privacidade';
const report = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  `orchestrator=${images.orchestrator}`,
  `web=${images.web}`,
  `privacy_url=${privacyUrl}`,
  'meta_privacy_email=atendimento@fluxfarma.com.br',
  '',
].join('\n');

mkdirSync(path.join(repoRoot, 'reports'), { recursive: true });
writeFileSync(path.join(repoRoot, 'reports', `deploy-privacy-outbound-${stamp}.txt`), report);
writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), `${tag}\n`);
console.log('\n' + report);
console.log(`\nMeta → Configurações do app → Básico → URL da Política de Privacidade:\n${privacyUrl}`);
