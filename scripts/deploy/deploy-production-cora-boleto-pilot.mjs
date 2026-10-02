#!/usr/bin/env node
/**
 * Deploy piloto Cora boletos (Flux / produção):
 * - Build + deploy flux-farma-api e flux-farma-web
 * - BILLING_CORA_ENABLED=true
 * - Monta mTLS em /secrets/nfse/cora-flux-mtls/ (mesmo SECRETS_DIR da NFS-e)
 * - post-deploy-pilot
 *
 * NÃO emite nem cancela boleto — só infraestrutura.
 *
 *   node scripts/deploy/deploy-production-cora-boleto-pilot.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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
const tag = process.env.DEPLOY_TAG || `prod-cora-boleto-pilot-${stamp}`;

const certPath = path.join(repoRoot, '.secrets', 'cora-flux-mtls', 'certificate.pem');
const keyPath = path.join(repoRoot, '.secrets', 'cora-flux-mtls', 'private-key.key');
if (!existsSync(certPath) || !existsSync(keyPath)) {
  throw new Error('mTLS ausente em .secrets/cora-flux-mtls/ (certificate.pem + private-key.key)');
}

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
  console.log('\n>', cmd.replace(/--data-file=\S+/g, '--data-file=<redacted>'));
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit', shell: true });
}

function ensureSecret(name, filePath) {
  let exists = false;
  try {
    execSync(`gcloud secrets describe ${name} --project=${project}`, {
      cwd: repoRoot,
      stdio: 'pipe',
      shell: true,
    });
    exists = true;
  } catch {
    exists = false;
  }
  if (!exists) {
    run(`gcloud secrets create ${name} --project=${project} --replication-policy=automatic --data-file="${filePath}"`);
  } else {
    run(`gcloud secrets versions add ${name} --project=${project} --data-file="${filePath}"`);
  }
}

console.log(JSON.stringify({ tag, images, project, region }, null, 2));

ensureSecret('cora-flux-mtls-certificate', certPath);
ensureSecret('cora-flux-mtls-private-key', keyPath);

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

// Cloud Run: dois secrets não montam no mesmo diretório — paths separados + env overrides.
run(
  `gcloud run services update flux-farma-api --project=${project} --region=${region} ` +
    `--update-env-vars="BILLING_CORA_ENABLED=true,BILLING_CORA_CERT_PATH=/secrets/cora-cert/certificate.pem,BILLING_CORA_KEY_PATH=/secrets/cora-key/private-key.key" ` +
    `--update-secrets="/secrets/cora-cert/certificate.pem=cora-flux-mtls-certificate:latest,/secrets/cora-key/private-key.key=cora-flux-mtls-private-key:latest"`,
);

run(
  `powershell -ExecutionPolicy Bypass -Command "$env:GCP_PROJECT_ID='${project}'; & .\\scripts\\gcp\\post-deploy-pilot.ps1"`,
);

const report = [
  `deployed_at=${new Date().toISOString()}`,
  `tag=${tag}`,
  `api_image=${images.api}`,
  `web_image=${images.web}`,
  '',
  'Escopo: Cora boleto MVP Flux + cancel API/UI; BILLING_CORA_ENABLED=true;',
  'mTLS montado em /secrets/nfse/cora-flux-mtls/ (reusa BILLING_NFSE_SECRETS_DIR).',
  'Este script NÃO emite nem cancela boleto.',
].join('\n');

writeFileSync(path.join(repoRoot, 'reports', 'last-deploy-tag.txt'), tag + '\n', 'utf8');
writeFileSync(path.join(repoRoot, 'reports', `deploy-cora-boleto-pilot-${stamp}.txt`), report + '\n', 'utf8');
console.log('\n' + report);
