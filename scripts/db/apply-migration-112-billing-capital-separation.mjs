#!/usr/bin/env node
import pg from 'pg';
import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveBillingDevDbUrl, projectRefFromConnectionString } from '../lib/billingDbGuard.mjs';

const repoRoot = process.cwd();
dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });
dotenv.config({ path: path.join(repoRoot, 'apps', 'api-service', '.env'), quiet: true });

const sql = readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', '112_billing_capital_separation.sql'),
  'utf8'
);
const connectionString = resolveBillingDevDbUrl(repoRoot);
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

await client.connect();
try {
  await client.query(sql);
  console.log(
    JSON.stringify(
      {
        ok: true,
        migration: '112_billing_capital_separation',
        target_ref: projectRefFromConnectionString(connectionString) || 'local',
      },
      null,
      2
    )
  );
} finally {
  await client.end();
}
