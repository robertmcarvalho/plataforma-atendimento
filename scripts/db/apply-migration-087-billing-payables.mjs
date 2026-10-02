#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { resolveBillingDevDbUrl, PRODUCTION_PROJECT_REF } from '../lib/billingDbGuard.mjs';

const repoRoot = process.cwd();
const sql = readFileSync(join(repoRoot, 'supabase/migrations/087_billing_payables_expenses.sql'), 'utf8');
const devUrl = resolveBillingDevDbUrl(repoRoot);

const client = new pg.Client({ connectionString: devUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(sql);
  console.log('Migration 087 (payables/expenses/suppliers) aplicada no banco DEV.');
  console.log(`Ref produção bloqueada: ${PRODUCTION_PROJECT_REF}`);
} finally {
  await client.end();
}
