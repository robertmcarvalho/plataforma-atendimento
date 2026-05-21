#!/usr/bin/env node
/**
 * Reativa projeto legado ojzzx via Management API e grava .secrets/legacy-db-url.txt
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LEGACY_REF = 'ojzzxqqatqncchnspkch';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const secretsDir = path.join(repoRoot, '.secrets');

function readSecret(name) {
  const p = path.join(secretsDir, name);
  if (!existsSync(p)) return '';
  return readFileSync(p, 'utf8').trim();
}

async function api(pathname, init = {}) {
  const token = (process.env.SUPABASE_ACCESS_TOKEN || readSecret('supabase-access-token.txt')).trim();
  if (!token) throw new Error('Token ausente em .secrets/supabase-access-token.txt');
  const res = await fetch(`https://api.supabase.com/v1${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

async function waitHealthy(maxMs = 600000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const { body } = await api(`/projects/${LEGACY_REF}`);
    const status = body?.status;
    process.stdout.write(`status=${status} `);
    if (status === 'ACTIVE_HEALTHY') return body;
    if (status === 'ACTIVE_UNHEALTHY') {
      await new Promise((r) => setTimeout(r, 15000));
      continue;
    }
    await new Promise((r) => setTimeout(r, 10000));
  }
  throw new Error('Timeout aguardando ACTIVE_HEALTHY');
}

async function main() {
  const before = await api(`/projects/${LEGACY_REF}`);
  console.log('before', before.body?.name, before.body?.status);

  if (before.body?.status === 'INACTIVE') {
    const restore = await api(`/projects/${LEGACY_REF}/restore`, { method: 'POST', body: '{}' });
    console.log('restore', restore.status, JSON.stringify(restore.body));
    if (!restore.ok) throw new Error(`restore falhou: ${JSON.stringify(restore.body)}`);
  }

  console.log('\nAguardando projeto ficar healthy...');
  await waitHealthy();

  const dbPassword =
    process.env.LEGACY_DB_PASSWORD ||
    readSecret('legacy-db-password.txt') ||
    readSecret('staging-db-password.txt');
  if (!dbPassword) throw new Error('Senha DB ausente: .secrets/legacy-db-password.txt ou staging-db-password.txt');

  const poolers = await api(`/projects/${LEGACY_REF}/config/database/pooler`);
  if (!poolers.ok) throw new Error(JSON.stringify(poolers.body));
  const rows = Array.isArray(poolers.body) ? poolers.body : [];
  const primary = rows.find((r) => r.database_type === 'PRIMARY') || rows[0];
  const raw = String(primary?.connection_string || primary?.connectionString || '');
  if (!raw) throw new Error('Pooler connection_string não retornada');
  const url = new URL(raw);
  url.password = encodeURIComponent(dbPassword);
  const legacyDbUrl = url.toString();

  mkdirSync(secretsDir, { recursive: true });
  writeFileSync(path.join(secretsDir, 'legacy-db-url.txt'), legacyDbUrl + '\n', 'utf8');
  writeFileSync(path.join(secretsDir, 'legacy-db-password.txt'), dbPassword + '\n', 'utf8');

  const keys = await api(`/projects/${LEGACY_REF}/api-keys?reveal=true`);
  const keyRows = Array.isArray(keys.body) ? keys.body : [];
  const service = keyRows.find((r) => String(r.name || '').toLowerCase().includes('service'));
  const urlApi = `https://${LEGACY_REF}.supabase.co`;
  writeFileSync(
    path.join(secretsDir, 'legacy-api.env'),
    [
      `# Legado ojzzx — refresh automático`,
      `SUPABASE_URL=${urlApi}`,
      `SUPABASE_SERVICE_ROLE_KEY=${service?.api_key || ''}`,
      '',
    ].join('\n'),
    'utf8'
  );

  console.log(JSON.stringify({ ok: true, ref: LEGACY_REF, legacy_db_url: '.secrets/legacy-db-url.txt' }, null, 2));
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
