#!/usr/bin/env node
/**
 * Aplica 083_commercial_lead_location_optional.sql em produção (omhlb).
 *   $env:CONFIRM_PRODUCTION_MIGRATION_083="true"
 *   node scripts/db/apply-migration-083-commercial-lead-location-optional.mjs --execute
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { execSqlStatements } from '../lib/execSqlStatements.mjs';
import { resolveProductionDbUrl, assertProductionTarget } from '../lib/loadProdEnv.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const execute = process.argv.includes('--execute');
const sqlPath = path.join(repoRoot, 'supabase', 'migrations', '083_commercial_lead_location_optional.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const dbUrl = resolveProductionDbUrl(repoRoot);
assertProductionTarget(dbUrl);

const isAlreadyOptional = async (client) => {
  const { rows } = await client.query(
    `SELECT column_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'commercial_leads'
       AND column_name IN ('trade_name', 'city', 'state')`,
  );
  return rows.length === 3 && rows.every((r) => r.is_nullable === 'YES');
};

console.log(
  JSON.stringify({ mode: execute ? 'execute' : 'dry-run', migration: '083_commercial_lead_location_optional.sql' }, null, 2),
);

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  if (await isAlreadyOptional(client)) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'trade_name/city/state already nullable' }, null, 2));
    process.exit(0);
  }

  if (!execute) {
    console.log('Dry-run. Use --execute com CONFIRM_PRODUCTION_MIGRATION_083=true');
    process.exit(0);
  }

  if (process.env.CONFIRM_PRODUCTION_MIGRATION_083 !== 'true') {
    console.error('Defina CONFIRM_PRODUCTION_MIGRATION_083=true');
    process.exit(1);
  }

  await execSqlStatements(client, sql);
  console.log(JSON.stringify({ ok: true, applied: '083_commercial_lead_location_optional' }, null, 2));
} finally {
  await client.end();
}
