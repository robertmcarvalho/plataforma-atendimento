#!/usr/bin/env node
/**
 * Aplica migration 102 (prévia de desligamento) em produção.
 *
 *   $env:CONFIRM_PRODUCTION_MIGRATION_102="true"
 *   node scripts/db/apply-migration-102-billing-driver-offboarding-preview-prod.mjs --execute
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProductionDbUrl, assertProductionTarget } from '../lib/loadProdEnv.mjs';

const execute = process.argv.includes('--execute');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

if (!execute) {
  console.log('Dry-run. Use --execute com CONFIRM_PRODUCTION_MIGRATION_102=true');
  process.exit(0);
}

if (process.env.CONFIRM_PRODUCTION_MIGRATION_102 !== 'true') {
  console.error('Defina CONFIRM_PRODUCTION_MIGRATION_102=true');
  process.exit(1);
}

process.env.CONFIRM_PRODUCTION_TARGET = 'true';
const dbUrl = resolveProductionDbUrl(repoRoot);
assertProductionTarget(dbUrl);

const sql = readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '102_billing_driver_offboarding_preview.sql'),
  'utf8'
);

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(sql);
  console.log(JSON.stringify({ ok: true, migration: '102_billing_driver_offboarding_preview', target: 'production' }, null, 2));
} finally {
  await client.end();
}
