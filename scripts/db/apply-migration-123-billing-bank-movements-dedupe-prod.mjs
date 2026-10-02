#!/usr/bin/env node
/**
 * Applies migration 123 (ensure billing_bank_movements dedupe unique index) to production.
 *
 * Dry-run / verify:
 *   node scripts/db/apply-migration-123-billing-bank-movements-dedupe-prod.mjs
 *
 * Execute:
 *   $env:CONFIRM_PRODUCTION_MIGRATION_123 = "true"
 *   node scripts/db/apply-migration-123-billing-bank-movements-dedupe-prod.mjs --execute
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

async function readIndex(client) {
  const { rows } = await client.query(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'billing_bank_movements'
      AND indexname = 'idx_billing_bank_movements_dedupe'
  `);
  return rows;
}

process.env.CONFIRM_PRODUCTION_TARGET = 'true';
const dbUrl = resolveProductionDbUrl(repoRoot);
assertProductionTarget(dbUrl);
const targetRef = refFromUrl(dbUrl);
const sql = readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '123_billing_bank_movements_dedupe_index.sql'),
  'utf8'
);

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const before = await readIndex(client);
  console.log(JSON.stringify({ targetRef, execute, before }, null, 2));
  if (!execute) {
    console.log('Dry-run only. Set CONFIRM_PRODUCTION_MIGRATION_123=true and pass --execute to apply.');
    process.exit(0);
  }
  if (process.env.CONFIRM_PRODUCTION_MIGRATION_123 !== 'true') {
    throw new Error('Set CONFIRM_PRODUCTION_MIGRATION_123=true to apply');
  }
  await client.query(sql);
  const after = await readIndex(client);
  console.log(JSON.stringify({ ok: true, migration: '123', targetRef, after }, null, 2));
} finally {
  await client.end();
}
