#!/usr/bin/env node
/**
 * Aplica 098_conversations_one_open_per_contact.sql em produção (omhlb).
 *
 *   $env:CONFIRM_PRODUCTION_MIGRATION_098="true"
 *   node scripts/db/apply-migration-098-conversations-one-open.mjs --execute
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
const sqlPath = path.join(repoRoot, 'supabase/migrations/098_conversations_one_open_per_contact.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const dbUrl = resolveProductionDbUrl(repoRoot);
assertProductionTarget(dbUrl);

async function migrationState(client) {
  const { rows: idx } = await client.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'conversations_one_open_per_contact_idx'`,
  );
  const { rows: dups } = await client.query(
    `SELECT COUNT(*)::int AS n FROM (
       SELECT workspace_id, contact_id FROM conversations
       WHERE status IN ('open', 'pending') AND contact_id IS NOT NULL
       GROUP BY workspace_id, contact_id HAVING COUNT(*) > 1
     ) t`,
  );
  return {
    has_unique_index: idx.length > 0,
    duplicate_open_groups: dups[0]?.n ?? 0,
  };
}

console.log(
  JSON.stringify({ mode: execute ? 'execute' : 'dry-run', migration: '098_conversations_one_open_per_contact.sql' }, null, 2),
);

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const before = await migrationState(client);
  console.log(JSON.stringify({ before }, null, 2));

  if (before.has_unique_index && before.duplicate_open_groups === 0) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'migration already applied' }, null, 2));
    process.exit(0);
  }

  if (!execute) {
    console.log('Dry-run. Use --execute com CONFIRM_PRODUCTION_MIGRATION_098=true');
    process.exit(0);
  }

  if (process.env.CONFIRM_PRODUCTION_MIGRATION_098 !== 'true') {
    console.error('Defina CONFIRM_PRODUCTION_MIGRATION_098=true');
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
  console.log(JSON.stringify({ ok: true, applied: '098_conversations_one_open_per_contact', after }, null, 2));

  if (after.duplicate_open_groups > 0) {
    console.error('Ainda há conversas open/pending duplicadas por contato.');
    process.exit(1);
  }
} finally {
  await client.end();
}
