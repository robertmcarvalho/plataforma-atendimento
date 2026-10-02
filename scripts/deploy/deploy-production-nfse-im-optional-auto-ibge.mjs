#!/usr/bin/env node
/**
 * Deploy flux-farma-api + flux-farma-web:
 * - Gate IM do tomador opcional (billingNfseTomadorGate)
 * - Auto-IBGE no cadastro de farmácia (ViaCEP + lista IBGE)
 *
 * NÃO liga BILLING_NFSE_ENABLED / BILLING_NFSE_ALLOW_PRODUCAO.
 *
 *   node scripts/deploy/deploy-production-nfse-im-optional-auto-ibge.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const repo = process.env.GCP_ARTIFACT_REPO || 'panel-services';

const now = new Date();
const ymd =
  String(now.getFullYear()) +
  String(now.getMonth() + 1).padStart(2, '0') +
  String(now.getDate()).padStart(2, '0');
const hm =
  String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
const stamp = `${ymd}-${hm}`;
const tag = process.env.DEPLOY_TAG || `prod-nfse-im-optional-auto-ibge-${stamp}`;

const subs = JSON.parse(readFileSync(path.join(repoRoot, 'reports', 'web-build-substitutions.json'), 'utf8'));
if (!subs.url?.includes('omhlbavfsttwcnybzvcd')) {
  throw new Error('reports/web-build-substitutions.json deve apontar para omhlb');
}

const baseSub = `_TAG=${tag},_REGION=${region},_REPO=${repo}`;
const images = {
  api: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-api:${tag}`,
  web: `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-web:${tag}-web`,
};

function run(cmd) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

console.log(JSON.stringify({ tag, images, project, region }, null, 2));

run(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api.yaml --project=${project} --substitutions=${baseSub}`,
);

const webSub = [
  `_TAG=${tag}-web`,
  `_REGION=${region}`,
  `_REPO=${repo}`,
  `_NEXT_PUBLIC_API_URL=${subs.api}`,
  `_NEXT_PUBLIC_SUPABASE_URL=${subs.url}`,
  `_NEXT_PUBLIC_SUPABASE_ANON_KEY=${subs.anon}`,
  `_NEXT_PUBLIC_BILLING_MODULE_ENABLED=true`,
].join(',');

run(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-web.yaml --project=${project} --substitutions="${webSub}"`,
);

run(`gcloud run services update flux-farma-api --project=${project} --region=${region} --image=${images.api}`);
run(`gcloud run services update flux-farma-web --project=${project} --region=${region} --image=${images.web}`);

run(
  `powershell -ExecutionPolicy Bypass -Command "$env:GCP_PROJECT_ID='${project}'; & .\\scripts\\gcp\\post-deploy-pilot.ps1"`,
);

const report = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  `api_image=${images.api}`,
  `web_image=${images.web}`,
  '',
  'Escopo: gate IM opcional + auto-IBGE cadastro farmácia.',
  'NFS-e emissão ainda OFF (BILLING_NFSE_ENABLED / ALLOW_PRODUCAO não alterados).',
  '',
  'Validação:',
  '- Smoke www + API /health',
  '- Cadastro farmácia: CEP → IBGE automático',
  '- UI/gate IM tomador opcional (sem emitir NF)',
].join('\n');

writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n', 'utf8');
writeFileSync(path.join(repoRoot, 'reports', `deploy-nfse-im-optional-auto-ibge-${stamp}.txt`), report + '\n', 'utf8');
console.log('\n' + report);
