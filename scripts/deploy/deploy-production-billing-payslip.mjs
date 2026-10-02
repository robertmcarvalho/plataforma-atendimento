#!/usr/bin/env node
/**
 * Deploy flux-farma-api + flux-farma-web: holerite (drawer A pagar + magic link + WhatsApp).
 *
 *   node scripts/deploy/deploy-production-billing-payslip.mjs
 *
 * Antes: aplicar migration 120
 *   $env:CONFIRM_PRODUCTION_MIGRATION_120="true"
 *   node scripts/db/apply-migration-120-billing-payslip-tokens.mjs --execute
 *
 * Pós-deploy obrigatório já incluso:
 *   npm run gcp:post-deploy:pilot
 *
 * Não rodar em paralelo com outro gcloud run deploy (agente das 5 fases).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const region = process.env.GCP_REGION || 'us-central1';
const repo = process.env.GCP_ARTIFACT_REPO || 'panel-services';
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + String(Date.now()).slice(-4);
const tag = process.env.DEPLOY_TAG || `prod-billing-payslip-${stamp}`;

const subs = JSON.parse(readFileSync(path.join(repoRoot, 'reports', 'web-build-substitutions.json'), 'utf8'));
if (!subs.url?.includes('omhlbavfsttwcnybzvcd')) {
  throw new Error('reports/web-build-substitutions.json deve apontar para omhlb (produção)');
}

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
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api.yaml --project=${project} --substitutions=_TAG=${tag},_REGION=${region},_REPO=${repo}`
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

run(`gcloud builds submit . --config=deploy/cloudbuild-flux-farma-web.yaml --project=${project} --substitutions="${webSub}"`);

run(
  `gcloud run services update flux-farma-api --project=${project} --region=${region} --image=${images.api} --update-env-vars=BILLING_PAYSLIP_WHATSAPP_TEMPLATE_NAME=flux_holerite_pagamento,BILLING_PAYSLIP_WHATSAPP_TEMPLATE_LANGUAGE=pt_BR,BILLING_PAYSLIP_TTL_DAYS=7`
);
run(`gcloud run services update flux-farma-web --project=${project} --region=${region} --image=${images.web}`);

run(
  `powershell -ExecutionPolicy Bypass -Command "$env:GCP_PROJECT_ID='${project}'; & .\\scripts\\gcp\\post-deploy-pilot.ps1"`
);

const report = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  `api_image=${images.api}`,
  `web_image=${images.web}`,
  '',
  'Smoke:',
  '  https://www.aetheraai.com.br/billing/pagar',
].join('\n');

const reportPath = path.join(repoRoot, 'reports', `deploy-billing-payslip-${stamp}.txt`);
writeFileSync(reportPath, report + '\n', 'utf8');
writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n', 'utf8');
console.log(report);
console.log('Report:', reportPath);
