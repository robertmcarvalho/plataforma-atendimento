/**
 * Aplica migração 030 (conversation_flow_bindings).
 *
 * Usage: npm run db:ensure:030
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';
import { execSqlStatements } from '../lib/execSqlStatements.mjs';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

dotenv.config({ path: path.join(repoRoot, 'apps', 'api-service', '.env') });
dotenv.config({ path: path.join(repoRoot, '.env') });

function readDbUrl() {
  const envUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (envUrl) return envUrl.trim();

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
      /* ignore */
    }
  }

  const secretPath = path.join(repoRoot, '.secrets', 'supabase-db-url.txt');
  if (fs.existsSync(secretPath)) {
    const value = fs.readFileSync(secretPath, 'utf8').trim();
    if (value) return value;
  }

  throw new Error(
    'Defina SUPABASE_DB_URL ou SUPABASE_URL+SUPABASE_DB_PASSWORD ou .secrets/supabase-db-url.txt'
  );
}

async function main() {
  const sqlPath = path.join(repoRoot, 'supabase', 'migrations', '030_conversation_flow_bindings.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = new Client({
    connectionString: readDbUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query('begin');
    await execSqlStatements(client, sql);
    await client.query('commit');
    console.log('OK: migração 030 aplicada (conversation_flow_bindings).');
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
