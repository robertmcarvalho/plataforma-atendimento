import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { config } from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(root, 'apps/api-service/.env') });
config({ path: path.join(root, '.env') });

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

  const secretPath = path.join(root, '.secrets', 'supabase-db-url.txt');
  if (existsSync(secretPath)) {
    const value = readFileSync(secretPath, 'utf8').trim();
    if (value) return value;
  }

  throw new Error(
    'Defina SUPABASE_DB_URL, DATABASE_URL, SUPABASE_URL+SUPABASE_DB_PASSWORD ou .secrets/supabase-db-url.txt',
  );
}

const sql = readFileSync(
  path.join(root, 'supabase/migrations/054_commercial_proposal_docx_pdf.sql'),
  'utf8',
);

const connectionString = readDbUrl();
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(sql);
  console.log('Migration 054 aplicada.');
} finally {
  await client.end();
}
