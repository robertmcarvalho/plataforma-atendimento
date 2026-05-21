import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

function readDbUrl() {
  const envUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (envUrl) return envUrl.trim();

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '..');
  const secretPath = path.join(root, '.secrets', 'supabase-db-url.txt');
  if (fs.existsSync(secretPath)) {
    const value = fs.readFileSync(secretPath, 'utf8').trim();
    if (value) return value;
  }

  throw new Error('Missing SUPABASE_DB_URL (or .secrets/supabase-db-url.txt).');
}

async function main() {
  const connectionString = readDbUrl();

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const root = path.resolve(scriptDir, '..');
    const sqlPath = path.join(root, 'supabase', 'migrations', '005_leader_and_finances.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await client.query('begin');
    await client.query(sql);
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

  console.log('DB_ENSURE_005_OK');
}

main().catch((err) => {
  const code = err?.code ? String(err.code) : '';
  const msg = (err?.message || '').trim();
  if (code === 'EACCES') {
    console.error('EACCES: conexao bloqueada. Permita node.exe e tente novamente.');
  }
  console.error([code, msg].filter(Boolean).join(': ') || String(err));
  process.exit(1);
});
