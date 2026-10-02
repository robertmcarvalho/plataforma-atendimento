#!/usr/bin/env node
/**
 * Aplica 114_workspace_membership_roles.sql em produção (omhlb).
 *
 *   $env:CONFIRM_PRODUCTION_MIGRATION_114="true"
 *   node scripts/db/apply-migration-114-workspace-membership-roles.mjs --execute
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
const sqlPath = path.join(repoRoot, 'supabase/migrations/114_workspace_membership_roles.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const dbUrl = resolveProductionDbUrl(repoRoot);
assertProductionTarget(dbUrl);

async function migrationState(client) {
  const { rows: table } = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'workspace_membership_roles'
    ) AS ok`,
  );
  let membershipRoles = 0;
  if (table[0]?.ok) {
    const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM workspace_membership_roles`);
    membershipRoles = rows[0]?.n ?? 0;
  }
  const { rows: memberships } = await client.query(
    `SELECT COUNT(*)::int AS n FROM workspace_memberships WHERE role_id IS NOT NULL AND is_active IS NOT DISTINCT FROM true`,
  );
  return {
    table_exists: Boolean(table[0]?.ok),
    membership_roles_rows: membershipRoles,
    active_memberships_with_role: memberships[0]?.n ?? 0,
  };
}

console.log(
  JSON.stringify({ mode: execute ? 'execute' : 'dry-run', migration: '114_workspace_membership_roles.sql' }, null, 2),
);

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const before = await migrationState(client);
  console.log(JSON.stringify({ before }, null, 2));

  if (before.table_exists && before.membership_roles_rows >= before.active_memberships_with_role && before.active_memberships_with_role > 0) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'workspace_membership_roles already backfilled' }, null, 2));
    process.exit(0);
  }

  if (!execute) {
    console.log('Dry-run. Use --execute com CONFIRM_PRODUCTION_MIGRATION_114=true');
    process.exit(0);
  }

  if (process.env.CONFIRM_PRODUCTION_MIGRATION_114 !== 'true') {
    console.error('Defina CONFIRM_PRODUCTION_MIGRATION_114=true');
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
  console.log(JSON.stringify({ ok: true, applied: '114_workspace_membership_roles', after }, null, 2));
} finally {
  await client.end();
}
