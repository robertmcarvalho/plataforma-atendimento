#!/usr/bin/env node
/**
 * Aplica 090_commercial_lead_scoring_and_phone_unique.sql em produção (omhlb).
 * Deduplica telefones duplicados e cria índice único + colunas de scoring IA.
 *
 *   $env:CONFIRM_PRODUCTION_MIGRATION_090="true"
 *   node scripts/db/apply-migration-090-commercial-lead-scoring.mjs --execute
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
const sqlPath = path.join(
  repoRoot,
  'supabase',
  'migrations',
  '090_commercial_lead_scoring_and_phone_unique.sql',
);
const sql = fs.readFileSync(sqlPath, 'utf8');
const dbUrl = resolveProductionDbUrl(repoRoot);
assertProductionTarget(dbUrl);

async function migrationState(client) {
  const { rows: cols } = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'commercial_leads'
       AND column_name = 'ai_score_set_at'`,
  );
  const { rows: idx } = await client.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'idx_commercial_leads_workspace_phone_unique'`,
  );
  const { rows: dups } = await client.query(
    `SELECT COUNT(*)::int AS groups FROM (
       SELECT workspace_id, phone FROM commercial_leads
       WHERE phone IS NOT NULL AND btrim(phone) <> ''
       GROUP BY workspace_id, phone HAVING COUNT(*) > 1
     ) t`,
  );
  return {
    has_ai_score_set_at: cols.length > 0,
    has_phone_unique_index: idx.length > 0,
    duplicate_phone_groups: dups[0]?.groups ?? 0,
  };
}

console.log(
  JSON.stringify(
    { mode: execute ? 'execute' : 'dry-run', migration: '090_commercial_lead_scoring_and_phone_unique.sql' },
    null,
    2,
  ),
);

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const before = await migrationState(client);
  console.log(JSON.stringify({ before }, null, 2));

  if (before.has_ai_score_set_at && before.has_phone_unique_index && before.duplicate_phone_groups === 0) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'migration already applied' }, null, 2));
    process.exit(0);
  }

  if (!execute) {
    console.log('Dry-run. Use --execute com CONFIRM_PRODUCTION_MIGRATION_090=true');
    process.exit(0);
  }

  if (process.env.CONFIRM_PRODUCTION_MIGRATION_090 !== 'true') {
    console.error('Defina CONFIRM_PRODUCTION_MIGRATION_090=true');
    process.exit(1);
  }

  await client.query('BEGIN');
  try {
    await execSqlStatements(client, sql);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }

  const after = await migrationState(client);
  console.log(JSON.stringify({ ok: true, applied: '090_commercial_lead_scoring_and_phone_unique', after }, null, 2));

  if (after.duplicate_phone_groups > 0) {
    console.error('Ainda há telefones duplicados após migration.');
    process.exit(1);
  }
} finally {
  await client.end();
}
