/**
 * Aplica migration 042 (ocorrências líder: occurrence_kind, coverage_of_entry_id).
 * Uso: node scripts/ensure-042-leader-occurrences.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { readDbUrl } from '../lib/readDbUrl.mjs';
import { execSqlStatements } from '../lib/execSqlStatements.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const migrationPath = path.join(root, 'supabase', 'migrations', '042_leader_occurrences_and_informed_status.sql');

const client = new pg.Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('begin');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  await execSqlStatements(client, sql);
  await client.query('commit');
  console.log(`OK: ${path.basename(migrationPath)} aplicada.`);
} catch (e) {
  await client.query('rollback');
  throw e;
} finally {
  await client.end();
}
