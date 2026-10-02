#!/usr/bin/env node
/**
 * Aplica 082_commercial_contract_onboarding.sql em produção (omhlb).
 *   $env:CONFIRM_PRODUCTION_MIGRATION_082="true"
 *   node scripts/db/apply-migration-082-commercial-contract-onboarding.mjs --execute
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
const sqlPath = path.join(repoRoot, 'supabase', 'migrations', '082_commercial_contract_onboarding.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const dbUrl = resolveProductionDbUrl(repoRoot);
assertProductionTarget(dbUrl);

const exists = async (client) => {
  const { rows } = await client.query(`SELECT to_regclass('public.commercial_notifications') AS reg`);
  return Boolean(rows[0]?.reg);
};

console.log(
  JSON.stringify({ mode: execute ? 'execute' : 'dry-run', migration: '082_commercial_contract_onboarding.sql' }, null, 2),
);

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  if (await exists(client)) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'commercial_notifications already exists' }, null, 2));
    process.exit(0);
  }

  if (!execute) {
    console.log('Dry-run. Use --execute com CONFIRM_PRODUCTION_MIGRATION_082=true');
    process.exit(0);
  }

  if (process.env.CONFIRM_PRODUCTION_MIGRATION_082 !== 'true') {
    console.error('Defina CONFIRM_PRODUCTION_MIGRATION_082=true');
    process.exit(1);
  }

  await execSqlStatements(client, sql);
  console.log(JSON.stringify({ ok: true, applied: '082_commercial_contract_onboarding' }, null, 2));
} finally {
  await client.end();
}
