/**
 * Apply migration 039_pharmacy_commercial_delivery.sql
 * Usage:
 *   node scripts/apply-migration-039.mjs
 *   $env:CONFIRM_PRODUCTION_MIGRATION_039="true"
 *   node scripts/apply-migration-039.mjs --execute
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
const sqlPath = path.join(repoRoot, 'supabase', 'migrations', '039_pharmacy_commercial_delivery.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

const dbUrl = readDbUrl();
const host = (() => {
  try {
    return new URL(dbUrl).host;
  } catch {
    return '(unparsed)';
  }
})();

console.log(
  JSON.stringify({ mode: execute ? 'execute' : 'dry-run', migration: '039_pharmacy_commercial_delivery.sql', host }, null, 2),
);

if (!execute) {
  console.log('Dry-run only. Pass --execute with CONFIRM_PRODUCTION_MIGRATION_039=true');
  process.exit(0);
}

if (process.env.CONFIRM_PRODUCTION_MIGRATION_039 !== 'true') {
  console.error('Blocked: set CONFIRM_PRODUCTION_MIGRATION_039=true');
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('begin');
  await execSqlStatements(client, sql);
  await client.query('commit');
  console.log('OK migration 039 applied');
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  throw e;
} finally {
  await client.end();
}
