/**
 * Aplica migration 046 (absence_disposition, proposed_discount_amount).
 * Uso: node scripts/ensure-046-absence-disposition.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { readDbUrl } from '../lib/readDbUrl.mjs';
import { execSqlStatements } from '../lib/execSqlStatements.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const migrationPath = path.join(root, 'supabase', 'migrations', '046_absence_disposition.sql');

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
