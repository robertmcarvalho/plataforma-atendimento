#!/usr/bin/env node
/**
 * Deploy flux-farma-api only — fix Id pedRegEvento (PRE+chave+101101).
 * Preserva env NFS-e/Cora (update só de imagem). NÃO cancela NFS-e.
 * post-deploy-pilot.ps1 obrigatório.
 *
 *   node scripts/deploy/deploy-production-nfse-cancel-id-fix.mjs
 */
import { writeFileSync } from 'node:fs';
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
const tag = process.env.DEPLOY_TAG || `prod-nfse-cancel-id-fix-${stamp}`;

const baseSub = `_TAG=${tag},_REGION=${region},_REPO=${repo}`;
const apiImage = `${region}-docker.pkg.dev/${project}/${repo}/flux-farma-api:${tag}`;

function run(cmd) {
  console.log('\n>', cmd);
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

console.log(JSON.stringify({ tag, apiImage, project, region }, null, 2));

run(
  `gcloud builds submit . --config=deploy/cloudbuild-flux-farma-api.yaml --project=${project} --substitutions=${baseSub}`
);

// Image-only — preserves BILLING_NFSE_* / BILLING_CORA_* env/secrets.
run(
  `gcloud run services update flux-farma-api --project=${project} --region=${region} --image=${apiImage}`
);

run(
  `powershell -ExecutionPolicy Bypass -Command "$env:GCP_PROJECT_ID='${project}'; & .\\scripts\\gcp\\post-deploy-pilot.ps1"`
);

const report = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  `api_image=${apiImage}`,
  '',
  'Escopo: fix Id pedRegEvento e101101 = PRE+chave(50)+101101 (sem nPed).',
  'Causa E1235 na tentativa DELTA 1766 (Id terminava em 001).',
  'Env NFS-e/Cora preservado (update só de imagem). NÃO cancelou NFS-e.',
  '',
  'Validação:',
  '- Smoke API /health',
  '- Faturamento DELTA: Cancelar NFS-e 1766 novamente (justificativa ≥15 chars)',
  '- Esperado: status canceled + last_error limpo',
].join('\n');

writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n', 'utf8');
writeFileSync(
  path.join(repoRoot, 'reports', `deploy-nfse-cancel-id-fix-${stamp}.txt`),
  report + '\n',
  'utf8'
);
console.log('\n' + report);
