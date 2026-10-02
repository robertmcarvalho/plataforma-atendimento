#!/usr/bin/env node
/**
 * Applies migration 124 (invoice interest + reconcile audit) to production.
 *
 * Dry-run:
 *   node scripts/db/apply-migration-124-billing-interest-audit-prod.mjs
 *
 * Execute:
 *   $env:CONFIRM_PRODUCTION_MIGRATION_124 = "true"
 *   node scripts/db/apply-migration-124-billing-interest-audit-prod.mjs --execute
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { resolveProductionDbUrl, assertProductionTarget } from '../lib/loadProdEnv.mjs';

const execute = process.argv.includes('--execute');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function refFromUrl(url) {
  return url.match(/db\.([a-z0-9]+)\.supabase\.co/i)?.[1] || url.match(/postgres\.([a-z0-9]+)/i)?.[1] || '?';
}

async function readColumns(client) {
  const { rows } = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('billing_payments', 'billing_bank_movements')
      AND column_name IN ('reconciled_by', 'reconciled_at')
    ORDER BY table_name, column_name
  `);
  return rows;
}

async function readFunctions(client) {
  const { rows } = await client.query(`
    SELECT proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND proname IN (
        'billing_add_invoice_interest',
        'billing_settle_invoice_with_interest',
        'billing_reconcile_payment'
      )
    ORDER BY proname
  `);
  return rows.map((r) => r.proname);
}

process.env.CONFIRM_PRODUCTION_TARGET = 'true';
const dbUrl = resolveProductionDbUrl(repoRoot);
assertProductionTarget(dbUrl);
const targetRef = refFromUrl(dbUrl);
const sql = readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '124_billing_interest_reconcile_audit.sql'),
  'utf8'
);

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const before = { columns: await readColumns(client), functions: await readFunctions(client) };
  console.log(JSON.stringify({ targetRef, execute, before }, null, 2));
  if (!execute) {
    console.log('Dry-run only. Set CONFIRM_PRODUCTION_MIGRATION_124=true and pass --execute to apply.');
    process.exit(0);
  }
  if (process.env.CONFIRM_PRODUCTION_MIGRATION_124 !== 'true') {
    throw new Error('Set CONFIRM_PRODUCTION_MIGRATION_124=true to apply');
  }
  await client.query(sql);
  const after = { columns: await readColumns(client), functions: await readFunctions(client) };
  console.log(JSON.stringify({ ok: true, migration: '124', targetRef, after }, null, 2));
} finally {
  await client.end();
}
