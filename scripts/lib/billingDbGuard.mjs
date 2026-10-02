import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/** Supabase produção — NUNCA destino de escrita do módulo billing em dev. */
export const PRODUCTION_PROJECT_REF = 'omhlbavfsttwcnybzvcd';

/**
 * AVISO para scripts one-off de billing: NUNCA alterar driver_pharmacy_links nem
 * primary_pharmacy_id sem aprovação explícita da operação. Billing corrige billing_delivery_records.
 */
export const BILLING_LINK_MUTATION_WARNING =
  'Scripts de billing NUNCA devem alterar driver_pharmacy_links nem primary_pharmacy_id sem aprovação da operação.';

const WRITE_SQL_RE =
  /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COMMENT\s+ON)\b/i;

export function projectRefFromConnectionString(connectionString) {
  const raw = String(connectionString || '');
  const m = raw.match(/db\.([a-z0-9]+)\.supabase\.co/i);
  if (m) return m[1];
  const pooler = raw.match(/postgres\.([a-z0-9]+)/i);
  if (pooler) return pooler[1];
  return '';
}

export function assertProductionReadSource(connectionString) {
  const ref = projectRefFromConnectionString(connectionString);
  if (ref !== PRODUCTION_PROJECT_REF) {
    throw new Error(
      `Origem deve ser produção (${PRODUCTION_PROJECT_REF}). Ref detectada: ${ref || 'desconhecida'}. ` +
        'Use .secrets/production-db-url.txt apenas para LEITURA.'
    );
  }
}

/** Bloqueia qualquer escrita no banco de produção. */
export function assertNeverProductionWriteTarget(connectionString) {
  const ref = projectRefFromConnectionString(connectionString);
  if (ref === PRODUCTION_PROJECT_REF) {
    throw new Error(
      `PROIBIDO: alterações no banco de dados de PRODUÇÃO (${PRODUCTION_PROJECT_REF}). ` +
        'Configure .secrets/billing-dev-db-url.txt ou staging para o destino.'
    );
  }
}

export function resolveProductionReadUrl(repoRoot = process.cwd()) {
  const fromEnv = process.env.PROD_SUPABASE_DB_URL || process.env.BILLING_FIXTURE_SOURCE_DB_URL;
  if (fromEnv?.trim()) {
    assertProductionReadSource(fromEnv.trim());
    return fromEnv.trim();
  }
  const secretPath = path.join(repoRoot, '.secrets', 'production-db-url.txt');
  if (!existsSync(secretPath)) {
    throw new Error('Crie .secrets/production-db-url.txt (somente leitura para fixture billing).');
  }
  const url = readFileSync(secretPath, 'utf8').trim();
  assertProductionReadSource(url);
  return url;
}

export function resolveBillingDevDbUrl(repoRoot = process.cwd()) {
  const fromEnv = process.env.BILLING_DEV_DB_URL || process.env.BILLING_FIXTURE_TARGET_DB_URL;
  if (fromEnv?.trim()) {
    assertNeverProductionWriteTarget(fromEnv.trim());
    return fromEnv.trim();
  }
  const candidates = [
    path.join(repoRoot, '.secrets', 'billing-dev-db-url.txt'),
    path.join(repoRoot, '.secrets', 'staging-supabase-db-url.txt'),
  ];
  for (const secretPath of candidates) {
    if (!existsSync(secretPath)) continue;
    const url = readFileSync(secretPath, 'utf8').trim();
    if (!url) continue;
    assertNeverProductionWriteTarget(url);
    return url;
  }
  throw new Error(
    'Destino dev ausente. Crie .secrets/billing-dev-db-url.txt (NÃO use production-db-url.txt).'
  );
}

/** Envolve client pg: produção só SELECT/WITH/SHOW/EXPLAIN. */
export function guardReadOnlyClient(client, label = 'PRODUÇÃO') {
  const original = client.query.bind(client);
  client.query = async (text, params) => {
    const sql = String(text).trim();
    if (WRITE_SQL_RE.test(sql)) {
      throw new Error(
        `PROIBIDO: escrita no banco de ${label}. Este script só lê produção. SQL bloqueado: ${sql.slice(0, 80)}…`
      );
    }
    return original(text, params);
  };
  return client;
}

export function sanitizeDevEmail(original, prefix, id) {
  const local = String(original || '').split('@')[0]?.replace(/[^a-z0-9+._-]/gi, '') || prefix;
  return `billing-dev+${prefix}-${String(id).slice(0, 8)}@example.local`;
}
