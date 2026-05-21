/**
 * Aplica migração 028 (sla_treatment_deadline) usando SUPABASE_DB_URL / DATABASE_URL
 * ou SUPABASE_URL + SUPABASE_DB_PASSWORD (mesma lógica de scripts/ensure-supabase-chat-enhancements.mjs).
 *
 * Usage: npm run db:ensure:028
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';

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
  const sqlPath = path.join(repoRoot, 'supabase', 'migrations', '028_conversation_sla_treatment.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = new Client({
    connectionString: readDbUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
    console.log('OK: migração 028 aplicada (sla_treatment_deadline).');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
