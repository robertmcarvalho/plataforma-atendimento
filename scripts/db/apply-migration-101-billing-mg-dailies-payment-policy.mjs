#!/usr/bin/env node
import pg from 'pg';
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveBillingDevDbUrl } from '../lib/billingDbGuard.mjs';

const repoRoot = process.cwd();
dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });
dotenv.config({ path: path.join(repoRoot, 'apps', 'api-service', '.env'), quiet: true });

const sql = readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '101_billing_mg_dailies_payment_policy.sql'),
  'utf8'
);
const client = new pg.Client({ connectionString: resolveBillingDevDbUrl(repoRoot), ssl: { rejectUnauthorized: false } });

await client.connect();
try {
  await client.query(sql);
  console.log(JSON.stringify({ ok: true, migration: '101_billing_mg_dailies_payment_policy' }, null, 2));
} finally {
  await client.end();
}
