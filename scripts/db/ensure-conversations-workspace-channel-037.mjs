/**
 * Aplica a migration 037 (conversations.workspace_channel_id) no banco configurado.
 *
 * Uso:
 *   npm run db:ensure:037
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

dotenv.config({ path: path.join(repoRoot, 'apps', 'api-service', '.env'), quiet: true });
dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });

function readSecretFile(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(fullPath)) return '';
  return fs.readFileSync(fullPath, 'utf8').trim();
}

function readDbUrl() {
  const direct =
    process.env.STAGING_SUPABASE_DB_URL ||
    process.env.STAGING_DATABASE_URL ||
    process.env.MIGRATION_STAGING_DB_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    readSecretFile('.secrets/staging-supabase-db-url.txt') ||
    readSecretFile('.secrets/supabase-db-url.txt');
  if (direct) return direct.trim();

  const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
  const dbPassword = (process.env.SUPABASE_DB_PASSWORD || '').trim();
  if (supabaseUrl && dbPassword) {
    const u = new URL(supabaseUrl);
    const ref = (u.hostname || '').split('.')[0];
    if (ref) return `postgresql://postgres:${encodeURIComponent(dbPassword)}@db.${ref}.supabase.co:5432/postgres`;
  }

  throw new Error('Defina STAGING_SUPABASE_DB_URL/SUPABASE_DB_URL ou .secrets/staging-supabase-db-url.txt.');
}

function fingerprint(rawUrl) {
  const u = new URL(rawUrl);
  return {
    host: u.host,
    database: u.pathname.replace(/^\//, '') || 'postgres',
    user: u.username || 'postgres',
  };
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Execução bloqueada: NODE_ENV=production.');
  }

  const dbUrl = readDbUrl();
  console.log(JSON.stringify({ migration: '037_conversations_workspace_channel.sql', target: fingerprint(dbUrl) }, null, 2));

  const sqlPath = path.join(repoRoot, 'supabase', 'migrations', '037_conversations_workspace_channel.sql');
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('begin');
    await execSqlStatements(client, fs.readFileSync(sqlPath, 'utf8'));
    await client.query('commit');
    console.log('OK: migration 037 aplicada.');
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
