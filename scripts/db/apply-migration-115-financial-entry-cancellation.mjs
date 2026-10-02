#!/usr/bin/env node
/**
 * Aplica 115_financial_entry_cancellation.sql em produção.
 *
 *   $env:CONFIRM_PRODUCTION_MIGRATION_115="true"
 *   node scripts/db/apply-migration-115-financial-entry-cancellation.mjs --execute
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { execSqlStatements } from '../lib/execSqlStatements.mjs';
import { resolveProductionDbUrl, assertProductionTarget } from '../lib/loadProdEnv.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const execute = process.argv.includes('--execute');
const sqlPath = path.join(repoRoot, 'supabase/migrations/115_financial_entry_cancellation.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const dbUrl = resolveProductionDbUrl(repoRoot);
assertProductionTarget(dbUrl);

async function migrationState(client) {
  const { rows } = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'financial_entries'
       AND column_name IN ('cancelled_by', 'cancelled_at', 'cancel_reason')`
  );
  return { columns: rows.map((r) => r.column_name) };
}

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();
try {
  const before = await migrationState(client);
  console.log('Estado atual:', before);
  if (!execute) {
    console.log('Dry-run. Use --execute com CONFIRM_PRODUCTION_MIGRATION_115=true');
    process.exit(0);
  }
  if (process.env.CONFIRM_PRODUCTION_MIGRATION_115 !== 'true') {
    console.error('Defina CONFIRM_PRODUCTION_MIGRATION_115=true');
    process.exit(1);
  }
  await execSqlStatements(client, sql);
  const after = await migrationState(client);
  console.log('Estado após migração:', after);
} finally {
  await client.end();
}
