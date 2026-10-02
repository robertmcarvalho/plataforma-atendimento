/**
 * Resolução segura de material mTLS Cora (certificate.pem + private-key.key).
 * Espelha o padrão NFS-e: secret_ref → .secrets/<ref>/… — nunca path traversal.
 */

import fs from 'node:fs';
import path from 'node:path';
import { BILLING_CORA_DEFAULTS, type BillingCoraEntityType } from './billingCoraTypes';

export class BillingCoraSecretsError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'BillingCoraSecretsError';
    this.status = status;
  }
}

function repoRootFromHere(): string {
  // apps/api-service/src/lib → repo root (CJS: __dirname)
  return path.resolve(__dirname, '../../../..');
}

export function defaultMtlsSecretRefForEntity(entityType: BillingCoraEntityType): string {
  return entityType === 'coop'
    ? BILLING_CORA_DEFAULTS.mtls_secret_ref_coop
    : BILLING_CORA_DEFAULTS.mtls_secret_ref_flux;
}

export function assertSafeSecretRef(secretRef: string): string {
  const ref = String(secretRef || '').trim();
  if (!ref) throw new BillingCoraSecretsError('mtls_secret_ref vazio.');
  if (path.isAbsolute(ref)) {
    throw new BillingCoraSecretsError(
      'mtls_secret_ref inválido. Use um nome simples (ex.: cora-flux-mtls), não path absoluto.'
    );
  }
  if (ref.includes('..') || ref.includes('/') || ref.includes('\\') || ref.includes('\0')) {
    throw new BillingCoraSecretsError(
      'mtls_secret_ref inválido. Use um nome simples (ex.: cora-flux-mtls).'
    );
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,118}$/.test(ref)) {
    throw new BillingCoraSecretsError('mtls_secret_ref contém caracteres inválidos.');
  }
  return ref;
}

export function resolveCoraSecretsDir(options?: { secretsDir?: string; repoRoot?: string }): string {
  return (
    options?.secretsDir ||
    process.env.BILLING_CORA_SECRETS_DIR?.trim() ||
    process.env.BILLING_NFSE_SECRETS_DIR?.trim() ||
    path.join(options?.repoRoot || repoRootFromHere(), '.secrets')
  );
}

export type CoraMtlsPaths = {
  dir: string;
  certificatePath: string;
  privateKeyPath: string;
};

/** Sufixo de env por secret_ref: cora-coop-mtls → CORA_COOP_MTLS. */
export function coraMtlsEnvSuffix(secretRef: string): string {
  return assertSafeSecretRef(secretRef).toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function mtlsPathsFromEnv(certEnv?: string, keyEnv?: string): CoraMtlsPaths | null {
  const cert = certEnv?.trim();
  const key = keyEnv?.trim();
  if (!cert || !key) return null;
  return { dir: path.dirname(cert), certificatePath: cert, privateKeyPath: key };
}

export function resolveCoraMtlsPaths(
  secretRef: string,
  options?: { secretsDir?: string; repoRoot?: string }
): CoraMtlsPaths {
  const ref = assertSafeSecretRef(secretRef);
  // Cloud Run: dois secrets não podem montar no mesmo diretório — paths absolutos via env.
  const suffix = coraMtlsEnvSuffix(ref);
  const perRef = mtlsPathsFromEnv(
    process.env[`BILLING_CORA_CERT_PATH_${suffix}`],
    process.env[`BILLING_CORA_KEY_PATH_${suffix}`]
  );
  if (perRef) return perRef;
  // Env genérico = material Flux; nunca aplicar a outra entidade (ex.: Coop usaria cert Flux).
  if (ref === BILLING_CORA_DEFAULTS.mtls_secret_ref_flux) {
    const legacy = mtlsPathsFromEnv(
      process.env.BILLING_CORA_CERT_PATH,
      process.env.BILLING_CORA_KEY_PATH
    );
    if (legacy) return legacy;
  }
  const secretsDir = resolveCoraSecretsDir(options);
  const dir = path.join(secretsDir, ref);
  return {
    dir,
    certificatePath: path.join(dir, BILLING_CORA_DEFAULTS.cert_filename),
    privateKeyPath: path.join(dir, BILLING_CORA_DEFAULTS.key_filename),
  };
}

export function coraMtlsMaterialExists(
  secretRef: string,
  options?: { secretsDir?: string; repoRoot?: string }
): boolean {
  try {
    const paths = resolveCoraMtlsPaths(secretRef, options);
    return (
      fs.existsSync(paths.certificatePath) &&
      fs.statSync(paths.certificatePath).isFile() &&
      fs.existsSync(paths.privateKeyPath) &&
      fs.statSync(paths.privateKeyPath).isFile()
    );
  } catch {
    return false;
  }
}

export type LoadedCoraMtlsMaterial = {
  certificatePem: string;
  privateKeyPem: string;
  certificatePath: string;
  privateKeyPath: string;
};

export function loadCoraMtlsMaterial(
  secretRef: string,
  options?: { secretsDir?: string; repoRoot?: string }
): LoadedCoraMtlsMaterial {
  const paths = resolveCoraMtlsPaths(secretRef, options);
  if (!fs.existsSync(paths.certificatePath) || !fs.statSync(paths.certificatePath).isFile()) {
    throw new BillingCoraSecretsError(
      `Certificado Cora ausente: ${paths.certificatePath}. Coloque certificate.pem em .secrets/${assertSafeSecretRef(secretRef)}/.`,
      400
    );
  }
  if (!fs.existsSync(paths.privateKeyPath) || !fs.statSync(paths.privateKeyPath).isFile()) {
    throw new BillingCoraSecretsError(
      `Private key Cora ausente: ${paths.privateKeyPath}. Coloque private-key.key em .secrets/${assertSafeSecretRef(secretRef)}/.`,
      400
    );
  }
  const certificatePem = fs.readFileSync(paths.certificatePath, 'utf8');
  const privateKeyPem = fs.readFileSync(paths.privateKeyPath, 'utf8');
  if (!certificatePem.includes('BEGIN CERTIFICATE')) {
    throw new BillingCoraSecretsError('certificate.pem não parece PEM válido.');
  }
  if (!privateKeyPem.includes('BEGIN') || !/PRIVATE KEY/i.test(privateKeyPem)) {
    throw new BillingCoraSecretsError('private-key.key não parece PEM de chave privada.');
  }
  return {
    certificatePem,
    privateKeyPem,
    certificatePath: paths.certificatePath,
    privateKeyPath: paths.privateKeyPath,
  };
}

/**
 * Persiste PEM/KEY no diretório do secret_ref (local .secrets).
 * Nunca retorna o conteúdo — só confirma paths.
 */
export function writeCoraMtlsMaterial(
  secretRef: string,
  material: { certificatePem: string; privateKeyPem: string },
  options?: { secretsDir?: string; repoRoot?: string }
): CoraMtlsPaths {
  const cert = String(material.certificatePem || '').trim();
  const key = String(material.privateKeyPem || '').trim();
  if (!cert.includes('BEGIN CERTIFICATE')) {
    throw new BillingCoraSecretsError('certificatePem inválido (esperado bloco PEM).');
  }
  if (!key.includes('BEGIN') || !/PRIVATE KEY/i.test(key)) {
    throw new BillingCoraSecretsError('privateKeyPem inválido (esperado bloco PEM de chave).');
  }
  const paths = resolveCoraMtlsPaths(secretRef, options);
  fs.mkdirSync(paths.dir, { recursive: true });
  fs.writeFileSync(paths.certificatePath, cert.endsWith('\n') ? cert : `${cert}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.writeFileSync(paths.privateKeyPath, key.endsWith('\n') ? key : `${key}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return paths;
}

/** Lê client_id opcional de arquivo local (bootstrap) — nunca versionado. */
export function readLocalCoraClientIdFile(
  entityType: BillingCoraEntityType,
  options?: { secretsDir?: string; repoRoot?: string }
): string | null {
  const secretsDir = resolveCoraSecretsDir(options);
  const candidates = [
    path.join(secretsDir, `cora-${entityType}-client-id.txt`),
    path.join(secretsDir, `cora-${entityType}.env`),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) continue;
    const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').trim();
    if (!raw) continue;
    if (p.endsWith('.env')) {
      const match = raw.match(/^\s*CORA_CLIENT_ID\s*=\s*(.+)\s*$/m);
      if (match) return match[1].trim().replace(/^["']|["']$/g, '');
      continue;
    }
    return raw.split(/\r?\n/)[0]?.trim() || null;
  }
  return null;
}
