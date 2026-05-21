import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Carrega variáveis de apps/api-service/.env (mesma base da API local).
 * Use USE_STAGING_SUPABASE=true para apontar scripts QA ao projeto em .secrets/staging-api.env.
 */
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

export function loadApiServiceEnv(repoRoot = process.cwd()) {
  parseEnvFile(path.join(repoRoot, 'apps', 'api-service', '.env'), true);
  if (process.env.USE_STAGING_SUPABASE === 'true') {
    parseEnvFile(path.join(repoRoot, '.secrets', 'staging-api.env'), true);
  }
}
