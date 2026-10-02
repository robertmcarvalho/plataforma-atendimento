/**
 * Smoke NFS-e Sprint 2 — build + sign DPS; POST Sefin só com --execute.
 *
 * Uso (repo root):
 *   node --import tsx scripts/smoke-nfse-dps-sefin.mjs
 *   node --import tsx scripts/smoke-nfse-dps-sefin.mjs --execute
 *
 * Requer explícito:
 *   BILLING_NFSE_SMOKE=1
 *
 * Certificado (gitignore):
 *   .secrets/billing-nfse-coop-pfx          (ou .pfx / .p12)
 *   .secrets/billing-nfse-coop-pfx.password (opcional; ou BILLING_NFSE_PFX_PASSWORD)
 *   Mesmo padrão para flux: billing-nfse-flux-pfx
 *
 * Env opcional:
 *   BILLING_NFSE_SMOKE_ENTITY=coop|flux
 *   BILLING_NFSE_SMOKE_SECRET_REF=billing-nfse-coop-pfx
 *   BILLING_NFSE_PFX_PASSWORD=...
 *
 * Sem --execute: só monta XML (+ assina se PFX existir). Nunca chama sefin.nfse.gov.br.
 * Com --execute: POST mTLS em sefin.producaorestrita.nfse.gov.br (exige PFX).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function hasFlag(name) {
  return process.argv.includes(name);
}

function printHelp() {
  console.log(`Smoke NFS-e DPS / Sefin (produção restrita)

  BILLING_NFSE_SMOKE=1 node --import tsx scripts/smoke-nfse-dps-sefin.mjs
  BILLING_NFSE_SMOKE=1 node --import tsx scripts/smoke-nfse-dps-sefin.mjs --execute

PFX local (não versionar):
  .secrets/billing-nfse-coop-pfx[.pfx|.p12]
  .secrets/billing-nfse-coop-pfx.password   # opcional
  .secrets/billing-nfse-flux-pfx[.pfx|.p12]

Dry-run (default): build XML; assina se cert existir; NÃO faz POST.
--execute: POST /SefinNacional/nfse em producaorestrita (exige cert).
`);
}

if (hasFlag('--help') || hasFlag('-h')) {
  printHelp();
  process.exit(0);
}

const smokeEnabled =
  process.env.BILLING_NFSE_SMOKE?.trim() === '1' ||
  process.env.BILLING_NFSE_SMOKE?.trim().toLowerCase() === 'true';

if (!smokeEnabled) {
  console.log(
    'SKIP_SMOKE_NFSE — defina BILLING_NFSE_SMOKE=1 para rodar (proteção contra POST acidental).'
  );
  printHelp();
  process.exit(0);
}

const execute = hasFlag('--execute');
const entity =
  (process.env.BILLING_NFSE_SMOKE_ENTITY || 'coop').trim().toLowerCase() === 'flux'
    ? 'flux'
    : 'coop';
const secretRef =
  process.env.BILLING_NFSE_SMOKE_SECRET_REF?.trim() || `billing-nfse-${entity}-pfx`;

const {
  buildDpsXml,
  buildFixtureDpsInput,
} = await import('../apps/api-service/src/lib/billingNfseDpsBuilder.ts');
const {
  pfxFileExists,
  resolvePfxPath,
  loadPfxMaterial,
  signDpsXmlToGzipBase64,
  hasSignatureElement,
  toPfxMaterialLogMeta,
} = await import('../apps/api-service/src/lib/billingNfseSigner.ts');
const {
  BillingNfseSefinClient,
  assertSefinRequestUrlAllowed,
  buildSefinNacionalBaseUrl,
} = await import('../apps/api-service/src/lib/billingNfseSefinClient.ts');

const outDir = path.join(repoRoot, 'tmp');
fs.mkdirSync(outDir, { recursive: true });

const input = buildFixtureDpsInput({
  entity_type: entity,
  simples_nacional: entity === 'flux',
  special_tax_regime: entity === 'coop' ? 'cooperativa' : 'none',
  dps_number: Number(process.env.BILLING_NFSE_SMOKE_DPS_NUMBER || '900001') || 900001,
  dps_series: process.env.BILLING_NFSE_SMOKE_DPS_SERIES?.trim() || '9',
});

const built = buildDpsXml(input);
const unsignedPath = path.join(outDir, `nfse-dps-unsigned-${entity}.xml`);
fs.writeFileSync(unsignedPath, built.xml, 'utf8');
console.log('OK build DPS', {
  entity,
  dps_id: built.dps_id,
  tp_amb: built.tp_amb,
  unsigned: unsignedPath,
});

// Hard-check: never resolve production URL
try {
  assertSefinRequestUrlAllowed('producao_restrita', 'https://sefin.nfse.gov.br/SefinNacional');
  console.error('FAIL: produção deveria ser bloqueada');
  process.exit(1);
} catch {
  console.log('OK guard: sefin.nfse.gov.br bloqueado');
}

const restritaBase = buildSefinNacionalBaseUrl('producao_restrita');
console.log('OK base restrita', restritaBase);

const certPresent = pfxFileExists(secretRef);
if (!certPresent) {
  console.log('SKIP_SIGN_NO_CERT — PFX ausente em', resolvePfxPath(secretRef));
  console.log(
    'Como colocar: copie o A1 da Coop/Flux para .secrets/' +
      secretRef +
      ' (ou .pfx/.p12) e opcionalmente .secrets/' +
      secretRef +
      '.password'
  );
  if (execute) {
    console.log('SKIP_EXECUTE_NO_CERT — --execute ignorado sem certificado.');
  }
  console.log('Dry-run concluído (XML unsigned). Approve→emit permanece Sprint 3.');
  process.exit(0);
}

const material = loadPfxMaterial(secretRef);
// Nunca logar forge/TLS Certificate nem PEMs — só metadados (evita ciclo issuerCertificate).
const certMeta = toPfxMaterialLogMeta(material);
const { signedXml, dpsXmlGZipB64 } = signDpsXmlToGzipBase64(built.xml, material);
if (!hasSignatureElement(signedXml)) {
  console.error('FAIL: assinatura ausente no XML');
  process.exit(1);
}
const signedPath = path.join(outDir, `nfse-dps-signed-${entity}.xml`);
fs.writeFileSync(signedPath, signedXml, 'utf8');
console.log('OK sign DPS', {
  secret_ref: secretRef,
  ...certMeta,
  signed: signedPath,
  gzip_b64_len: dpsXmlGZipB64.length,
});

if (!execute) {
  console.log('Dry-run OK — sem POST. Passe --execute para chamar produção restrita.');
  process.exit(0);
}

console.log('EXECUTE POST', `${restritaBase}/nfse`);
const client = new BillingNfseSefinClient({
  environment: 'producao_restrita',
  material,
});
const response = await client.postNfseWithHttps(dpsXmlGZipB64);
const respPath = path.join(outDir, `nfse-sefin-response-${entity}.json`);
fs.writeFileSync(
  respPath,
  JSON.stringify(
    {
      ok: response.ok,
      status: response.status,
      chaveAcesso: response.chaveAcesso,
      idDps: response.idDps,
      erros: response.erros,
      // raw pode conter dados fiscais — gravado só em tmp/ local
      raw: response.raw,
    },
    null,
    2
  ),
  'utf8'
);
console.log('Sefin response', {
  ok: response.ok,
  status: response.status,
  chaveAcesso: response.chaveAcesso,
  erros: response.erros,
  saved: respPath,
});
process.exit(response.ok ? 0 : 2);
