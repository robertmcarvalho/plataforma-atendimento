/**
 * Apply migration 038_rate_limit_buckets.sql
 * Usage:
 *   $env:SUPABASE_DB_URL=(Get-Content .secrets/staging-supabase-db-url.txt -Raw).Trim()
 *   $env:CONFIRM_PRODUCTION_MIGRATION_038="true"
 *   node scripts/apply-migration-038.mjs --execute
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { readDbUrl } from './lib/readDbUrl.mjs';
import { execSqlStatements } from './lib/execSqlStatements.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const execute = process.argv.includes('--execute');
const sqlPath = path.join(repoRoot, 'supabase', 'migrations', '038_rate_limit_buckets.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

let dbUrl = '';
try {
  dbUrl = readDbUrl();
} catch {
  const stagingPath = path.join(repoRoot, '.secrets', 'staging-supabase-db-url.txt');
  if (fs.existsSync(stagingPath)) dbUrl = fs.readFileSync(stagingPath, 'utf8').trim();
}

if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL. Set env or .secrets/staging-supabase-db-url.txt');
  process.exit(1);
}

const host = (() => {
  try {
    return new URL(dbUrl).host;
  } catch {
    return '(unparsed)';
  }
})();

console.log(JSON.stringify({ mode: execute ? 'execute' : 'dry-run', migration: '038_rate_limit_buckets.sql', host }, null, 2));

if (!execute) {
  console.log('Dry-run only. Pass --execute with CONFIRM_PRODUCTION_MIGRATION_038=true');
  process.exit(0);
}

if (process.env.CONFIRM_PRODUCTION_MIGRATION_038 !== 'true') {
  console.error('Blocked: set CONFIRM_PRODUCTION_MIGRATION_038=true');
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('begin');
  await execSqlStatements(client, sql);
  await client.query('commit');
  console.log('OK migration 038 applied');
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  throw e;
} finally {
  await client.end();
}
