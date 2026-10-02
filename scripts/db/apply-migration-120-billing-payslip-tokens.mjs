#!/usr/bin/env node
/**
 * Aplica 120_billing_payslip_tokens.sql em produção.
 *
 *   $env:CONFIRM_PRODUCTION_MIGRATION_120="true"
 *   node scripts/db/apply-migration-120-billing-payslip-tokens.mjs --execute
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
const sqlPath = path.join(repoRoot, 'supabase/migrations/120_billing_payslip_tokens.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const dbUrl = resolveProductionDbUrl(repoRoot);
assertProductionTarget(dbUrl);

async function migrationState(client) {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'billing_payslip_tokens'
     ) AS ok`
  );
  return { table: Boolean(rows[0]?.ok) };
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const before = await migrationState(client);
  console.log('Estado atual:', before);
  if (!execute) {
    console.log('Dry-run. Use --execute com CONFIRM_PRODUCTION_MIGRATION_120=true');
    process.exit(0);
  }
  if (process.env.CONFIRM_PRODUCTION_MIGRATION_120 !== 'true') {
    console.error('Defina CONFIRM_PRODUCTION_MIGRATION_120=true');
    process.exit(1);
  }
  await execSqlStatements(client, sql);
  const after = await migrationState(client);
  console.log('Estado após migração:', after);
} finally {
  await client.end();
}
