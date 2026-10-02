#!/usr/bin/env node
/**
 * Aplica migration 084 (billing foundation) SOMENTE no banco dev/staging.
 * PROIBIDO apontar para produção (omhlb) — usa billingDbGuard.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { resolveBillingDevDbUrl, PRODUCTION_PROJECT_REF } from '../lib/billingDbGuard.mjs';

const repoRoot = process.cwd();
const sql = readFileSync(join(repoRoot, 'supabase/migrations/084_billing_foundation.sql'), 'utf8');
const devUrl = resolveBillingDevDbUrl(repoRoot);

const client = new pg.Client({ connectionString: devUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(sql);
  console.log('Migration 084 (billing foundation) aplicada no banco DEV.');
  console.log(`Ref produção bloqueada para escrita: ${PRODUCTION_PROJECT_REF}`);
} finally {
  await client.end();
}
