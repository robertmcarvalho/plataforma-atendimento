import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/** Supabase plataforma_atendimento — banco de produção (aetheraai.com.br). */
const PROD_REF = 'omhlbavfsttwcnybzvcd';
/** Projeto legado pausável (ex-staging no Dashboard); não usar em produção. */
const LEGACY_REF = 'ojzzxqqatqncchnspkch';
const DEV_REF = 'omhlbavfsttwcnybzvcd';

export function parseEnvFile(filePath, override = false) {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (override || !process.env[key]) process.env[key] = value;
  }
}

/** Carrega credenciais de produção a partir de .secrets/staging-api.env (atual prod) ou PROD_* env. */
export function loadProductionApiEnv(repoRoot = process.cwd()) {
  const prodApiEnv = path.join(repoRoot, '.secrets', 'production-api.env');
  const stagingApiEnv = path.join(repoRoot, '.secrets', 'staging-api.env');
  if (existsSync(prodApiEnv)) {
    parseEnvFile(prodApiEnv, true);
  } else if (existsSync(stagingApiEnv)) {
    parseEnvFile(stagingApiEnv, true);
  }
  if (process.env.PROD_SUPABASE_URL) process.env.SUPABASE_URL = process.env.PROD_SUPABASE_URL;
  if (process.env.PROD_SUPABASE_SERVICE_ROLE_KEY) {
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.PROD_SUPABASE_SERVICE_ROLE_KEY;
  }
}

export function resolveProductionDbUrl(repoRoot = process.cwd()) {
  const fromEnv = process.env.PROD_SUPABASE_DB_URL || process.env.SUPABASE_DB_URL;
  if (fromEnv?.trim()) return fromEnv.trim();
  const candidates = [
    path.join(repoRoot, '.secrets', 'production-db-url.txt'),
    path.join(repoRoot, '.secrets', 'supabase-db-url.txt'),
  ];
  for (const secretPath of candidates) {
    if (!existsSync(secretPath)) continue;
    const value = readFileSync(secretPath, 'utf8').trim();
    if (!value) continue;
    if (secretPath.endsWith('supabase-db-url.txt') && value.includes(DEV_REF)) {
      continue;
    }
    return value;
  }
  throw new Error(
    `Defina PROD_SUPABASE_DB_URL ou crie .secrets/production-db-url.txt (pooler do projeto ${PROD_REF}).`
  );
}

export function assertProductionTarget(connectionStringOrUrl) {
  const raw = String(connectionStringOrUrl || '');
  const supabaseUrl = String(process.env.SUPABASE_URL || '');
  if (raw.includes(LEGACY_REF) || supabaseUrl.includes(LEGACY_REF)) {
    throw new Error(`Bloqueado: destino é legado (${LEGACY_REF}). Use produção ${PROD_REF}.`);
  }
  const isProd =
    raw.includes(PROD_REF) ||
    supabaseUrl.includes(PROD_REF) ||
    process.env.CONFIRM_PRODUCTION_TARGET === 'true';
  if (!isProd) {
    throw new Error(
      `Bloqueado: destino não identificado como produção (${PROD_REF}). Defina CONFIRM_PRODUCTION_TARGET=true.`
    );
  }
}

export function projectRefFromSupabaseUrl(url) {
  try {
    return new URL(url).hostname.split('.')[0];
  } catch {
    return '';
  }
}
