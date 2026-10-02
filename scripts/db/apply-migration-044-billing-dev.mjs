#!/usr/bin/env node
/** Aplica migration 044 (pix_key_type, flux fields) no banco billing-dev apenas. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { resolveBillingDevDbUrl } from '../lib/billingDbGuard.mjs';

const repoRoot = process.cwd();
const sql = readFileSync(join(repoRoot, 'supabase/migrations/044_driver_flux_delivery_fields.sql'), 'utf8');
const client = new pg.Client({
  connectionString: resolveBillingDevDbUrl(repoRoot),
  ssl: { rejectUnauthorized: false },
});
await client.connect();
try {
  await client.query(sql);
  console.log('Migration 044 aplicada no billing-dev.');
} finally {
  await client.end();
}
