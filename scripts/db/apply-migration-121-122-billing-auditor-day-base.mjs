#!/usr/bin/env node
/**
 * Aplica 121_billing_financial_auditor_role.sql + 122_billing_day_base_and_mg_overlay.sql em produção.
 *
 *   $env:CONFIRM_PRODUCTION_MIGRATION_121_122="true"
 *   node scripts/db/apply-migration-121-122-billing-auditor-day-base.mjs --execute
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
const sql121 = fs.readFileSync(path.join(repoRoot, 'supabase/migrations/121_billing_financial_auditor_role.sql'), 'utf8');
const sql122 = fs.readFileSync(path.join(repoRoot, 'supabase/migrations/122_billing_day_base_and_mg_overlay.sql'), 'utf8');
const dbUrl = resolveProductionDbUrl(repoRoot);
assertProductionTarget(dbUrl);

async function migrationState(client) {
  const { rows } = await client.query(
    `SELECT
       EXISTS (
         SELECT 1 FROM public.roles WHERE name = 'financial_auditor' LIMIT 1
       ) AS auditor_role,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'pharmacies' AND column_name = 'driver_day_base_enabled'
       ) AS day_base_col,
       EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'billing_settlement_day_base_days'
       ) AS day_base_table,
       EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'billing_settlement_mg_overlays'
       ) AS mg_overlay_table`
  );
  return rows[0];
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const before = await migrationState(client);
  console.log('Estado atual:', before);
  if (!execute) {
    console.log('Dry-run. Use --execute com CONFIRM_PRODUCTION_MIGRATION_121_122=true');
    process.exit(0);
  }
  if (process.env.CONFIRM_PRODUCTION_MIGRATION_121_122 !== 'true') {
    console.error('Defina CONFIRM_PRODUCTION_MIGRATION_121_122=true');
    process.exit(1);
  }
  await execSqlStatements(client, sql121);
  await execSqlStatements(client, sql122);
  const after = await migrationState(client);
  console.log('Estado após migração:', after);
} finally {
  await client.end();
}
