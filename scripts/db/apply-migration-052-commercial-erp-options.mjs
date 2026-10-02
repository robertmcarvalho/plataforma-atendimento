#!/usr/bin/env node
/**
 * Aplica 052_commercial_erp_options.sql em produção (omhlb).
 *   $env:CONFIRM_PRODUCTION_MIGRATION_052="true"
 *   node scripts/db/apply-migration-052-commercial-erp-options.mjs --execute
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
const sqlPath = path.join(repoRoot, 'supabase', 'migrations', '052_commercial_erp_options.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const dbUrl = resolveProductionDbUrl(repoRoot);
assertProductionTarget(dbUrl);

const exists = async (client) => {
  const { rows } = await client.query(`SELECT to_regclass('public.commercial_erp_options') AS reg`);
  return Boolean(rows[0]?.reg);
};

console.log(
  JSON.stringify({ mode: execute ? 'execute' : 'dry-run', migration: '052_commercial_erp_options.sql' }, null, 2),
);

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  if (await exists(client)) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'table already exists' }, null, 2));
    process.exit(0);
  }

  if (!execute) {
    console.log('Dry-run. Use --execute com CONFIRM_PRODUCTION_MIGRATION_052=true');
    process.exit(0);
  }

  if (process.env.CONFIRM_PRODUCTION_MIGRATION_052 !== 'true') {
    console.error('Defina CONFIRM_PRODUCTION_MIGRATION_052=true');
    process.exit(1);
  }

  await execSqlStatements(client, sql);
  console.log(JSON.stringify({ ok: true, created: 'commercial_erp_options' }, null, 2));
} finally {
  await client.end();
}
