#!/usr/bin/env node
/**
 * Aplica 099_system_note_users.sql em produção (omhlb).
 *
 *   $env:CONFIRM_PRODUCTION_MIGRATION_099="true"
 *   node scripts/db/apply-migration-099-system-note-users.mjs --execute
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
const sqlPath = path.join(repoRoot, 'supabase/migrations/099_system_note_users.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const dbUrl = resolveProductionDbUrl(repoRoot);
assertProductionTarget(dbUrl);

async function migrationState(client) {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM users WHERE lower(trim(name)) = 'sistema'`,
  );
  const { rows: ws } = await client.query(`SELECT COUNT(*)::int AS n FROM workspaces`);
  return {
    sistema_users: rows[0]?.n ?? 0,
    workspaces: ws[0]?.n ?? 0,
  };
}

console.log(
  JSON.stringify({ mode: execute ? 'execute' : 'dry-run', migration: '099_system_note_users.sql' }, null, 2),
);

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const before = await migrationState(client);
  console.log(JSON.stringify({ before }, null, 2));

  if (before.workspaces > 0 && before.sistema_users >= before.workspaces) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'system users already provisioned' }, null, 2));
    process.exit(0);
  }

  if (!execute) {
    console.log('Dry-run. Use --execute com CONFIRM_PRODUCTION_MIGRATION_099=true');
    process.exit(0);
  }

  if (process.env.CONFIRM_PRODUCTION_MIGRATION_099 !== 'true') {
    console.error('Defina CONFIRM_PRODUCTION_MIGRATION_099=true');
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
  console.log(JSON.stringify({ ok: true, applied: '099_system_note_users', after }, null, 2));
} finally {
  await client.end();
}
