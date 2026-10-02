#!/usr/bin/env node
/**
 * Aplica migration 085 (ciclos, entregas, acertos) SOMENTE no banco dev/staging.
 * PROIBIDO apontar para produção (omhlb) — usa billingDbGuard.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { resolveBillingDevDbUrl, PRODUCTION_PROJECT_REF } from '../lib/billingDbGuard.mjs';

const repoRoot = process.cwd();
const sql = readFileSync(join(repoRoot, 'supabase/migrations/085_billing_cycles_deliveries_settlements.sql'), 'utf8');
const devUrl = resolveBillingDevDbUrl(repoRoot);

const client = new pg.Client({ connectionString: devUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(sql);
  console.log('Migration 085 (billing cycles/deliveries/settlements) aplicada no banco DEV.');
  console.log(`Ref produção bloqueada para escrita: ${PRODUCTION_PROJECT_REF}`);
} finally {
  await client.end();
}
