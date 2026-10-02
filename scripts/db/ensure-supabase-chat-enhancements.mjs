import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

function readDbUrl() {
  const envUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (envUrl) return envUrl.trim();

  // Convenience: build a Supabase DB URL from SUPABASE_URL + password.
  // This avoids storing a full connection string in the repo.
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
  const dbPassword = (process.env.SUPABASE_DB_PASSWORD || '').trim();
  if (supabaseUrl && dbPassword) {
    try {
      const u = new URL(supabaseUrl);
      const ref = (u.hostname || '').split('.')[0];
      if (ref) {
        const enc = encodeURIComponent(dbPassword);
        return `postgresql://postgres:${enc}@db.${ref}.supabase.co:5432/postgres`;
      }
    } catch {
      // ignore
    }
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '..');
  const secretPath = path.join(root, '.secrets', 'supabase-db-url.txt');
  if (fs.existsSync(secretPath)) {
    const value = fs.readFileSync(secretPath, 'utf8').trim();
    if (value) return value;
  }

  throw new Error(
    'Missing SUPABASE_DB_URL. Set SUPABASE_DB_URL, or set SUPABASE_URL + SUPABASE_DB_PASSWORD, or create .secrets/supabase-db-url.txt (gitignored).'
  );
}

async function main() {
  const connectionString = readDbUrl();

  const client = new Client({
    connectionString,
    // Supabase requires TLS; relax local CA validation for developer machines.
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query('begin');

    await client.query(`
      alter table public.conversations
      add column if not exists has_unread boolean not null default false;
    `);

    await client.query(`
      create table if not exists public.app_settings (
        key text primary key,
        value jsonb not null,
        updated_at timestamptz not null default now()
      );
    `);

    await client.query(`
      insert into public.app_settings (key, value)
      values ('chat_signature_enabled', 'true'::jsonb)
      on conflict (key) do nothing;
    `);

    await client.query(`
      create index if not exists idx_conversations_has_unread
      on public.conversations (has_unread)
      where has_unread = true;
    `);

    await client.query('commit');
  } catch (err) {
    try {
      await client.query('rollback');
    } catch {
      // ignore
    }
    throw err;
  } finally {
    await client.end();
  }

  // eslint-disable-next-line no-console
  console.log('DB_ENSURE_002_OK');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  const message = (() => {
    if (!err) return 'Unknown error';
    const code = err?.code ? String(err.code) : '';
    const msg = (err?.message || '').trim();
    if (err?.name === 'AggregateError' && Array.isArray(err?.errors) && err.errors.length) {
      const inner = err.errors
        .map((e) => {
          const c = e?.code ? String(e.code) : e?.name ? String(e.name) : '';
          const m = (e?.message || '').trim();
          return [c, m].filter(Boolean).join(': ') || String(e);
        })
        .join(' | ');
      return [code || 'AggregateError', inner].filter(Boolean).join(': ');
    }

    if (code && msg) return `${code}: ${msg}`;
    if (code) return code;
    if (msg) return msg;
    return String(err);
  })();
  // Friendly hint for the most common Windows issue: Supabase db.<ref>.supabase.co sometimes returns AAAA only.
  // If IPv6 is disabled, Node's getaddrinfo can fail with ENOENT/ENOTFOUND.
  if ((message || '').includes('getaddrinfo ENOENT')) {
    try {
      const raw = readDbUrl();
      const u = new URL(raw);
      const host = u.hostname || '';
      if (host.startsWith('db.') && host.endsWith('.supabase.co')) {
        // eslint-disable-next-line no-console
        console.error('Falha de DNS ao resolver o host do Postgres do Supabase.');
        // eslint-disable-next-line no-console
        console.error(`Host: ${host}`);
        // eslint-disable-next-line no-console
        console.error('Causa comum: o host retorna apenas IPv6 (AAAA) e sua maquina esta com IPv6 desabilitado.');
        // eslint-disable-next-line no-console
        console.error('Como resolver:');
        // eslint-disable-next-line no-console
        console.error('- Opcao A: habilite IPv6 no adaptador de rede (ms_tcpip6).');
        // eslint-disable-next-line no-console
        console.error('- Opcao B: use a connection string do Pooler no SUPABASE_DB_URL (Settings -> Database -> Connection string).');
        process.exit(1);
      }
    } catch {
      // ignore and fallthrough to default error
    }
  }

  // Another common Windows issue: outgoing connections blocked by firewall/antivirus (shows as EACCES).
  if ((err?.code || '').toString() === 'EACCES') {
    try {
      const raw = readDbUrl();
      const u = new URL(raw);
      const host = u.hostname || '';
      const port = u.port || '';
      // eslint-disable-next-line no-console
      console.error('Falha ao conectar no Postgres (EACCES).');
      // eslint-disable-next-line no-console
      console.error(`Host: ${host}${port ? `:${port}` : ''}`);
      // eslint-disable-next-line no-console
      console.error('Causa comum: firewall/antivirus/Controlled Folder Access bloqueando o node.exe.');
      // eslint-disable-next-line no-console
      console.error('Como resolver: permita o node.exe no Windows Security e no Firewall para conexoes de saida e tente novamente.');
    } catch {
      // ignore
    }
  }

  // eslint-disable-next-line no-console
  console.error(message);
  process.exit(1);
});
