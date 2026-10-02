#!/usr/bin/env node
/**
 * Applies migration 094 (C6 PIX template CHECK) to production.
 *
 * Dry-run:
 *   node scripts/db/apply-migration-094-billing-c6-pix-prod.mjs
 *
 * Execute:
 *   $env:CONFIRM_PRODUCTION_MIGRATION_094 = "true"
 *   node scripts/db/apply-migration-094-billing-c6-pix-prod.mjs --execute
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { resolveProductionDbUrl, assertProductionTarget } from '../lib/loadProdEnv.mjs';

const execute = process.argv.includes('--execute');
const verifyOnly = process.argv.includes('--verify');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function refFromUrl(url) {
  return url.match(/db\.([a-z0-9]+)\.supabase\.co/i)?.[1] || url.match(/postgres\.([a-z0-9]+)/i)?.[1] || '?';
}

async function readConstraint(client) {
  const { rows } = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'public.billing_bank_accounts'::regclass
      AND conname = 'billing_bank_accounts_pix_export_template_check'
  `);
  return rows;
}

process.env.CONFIRM_PRODUCTION_TARGET = 'true';
const dbUrl = resolveProductionDbUrl(repoRoot);
assertProductionTarget(dbUrl);
const targetRef = refFromUrl(dbUrl);

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  const before = await readConstraint(client);
  const includesC6 = before.some((r) => String(r.def || '').includes("'c6'"));

  if (verifyOnly || !execute) {
    console.log(
      JSON.stringify(
        {
          mode: verifyOnly ? 'verify' : 'dry-run',
          target_ref: targetRef,
          includes_c6: includesC6,
          constraint: before,
          next: includesC6
            ? 'already_applied'
            : 'run with --execute and CONFIRM_PRODUCTION_MIGRATION_094=true',
        },
        null,
        2
      )
    );
    if (!execute) process.exit(0);
  }

  if (process.env.CONFIRM_PRODUCTION_MIGRATION_094 !== 'true') {
    console.error('Defina CONFIRM_PRODUCTION_MIGRATION_094=true');
    process.exit(1);
  }

  if (includesC6) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'c6 already in CHECK', target_ref: targetRef, constraint: before }, null, 2));
    process.exit(0);
  }

  const sql = readFileSync(
    path.join(repoRoot, 'supabase', 'migrations', '094_billing_c6_pix_template.sql'),
    'utf8'
  );
  await client.query(sql);
  const after = await readConstraint(client);
  const ok = after.some((r) => String(r.def || '').includes("'c6'"));
  console.log(
    JSON.stringify(
      {
        ok,
        migration: '094_billing_c6_pix_template',
        target_ref: targetRef,
        before,
        after,
      },
      null,
      2
    )
  );
  if (!ok) process.exit(1);
} finally {
  await client.end();
}
