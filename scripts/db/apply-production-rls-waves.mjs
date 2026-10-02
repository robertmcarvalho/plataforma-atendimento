#!/usr/bin/env node
/**
 * Rollout RLS waves 1–12 em produção (omhlb).
 *
 * Dry-run (auditoria + plano):
 *   npm run prod:apply:rls-waves
 *
 * Executar:
 *   $env:CONFIRM_PRODUCTION_RLS_ROLLOUT="true"
 *   npm run prod:apply:rls-waves -- --execute
 *
 * Intervalo opcional:
 *   npm run prod:apply:rls-waves -- --execute --from 1 --to 12
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { assertProductionTarget, resolveProductionDbUrl } from '../lib/loadProdEnv.mjs';
import { execSqlStatements } from '../lib/execSqlStatements.mjs';

const WAVES = {
  1: { enable: '055_rls_enable_wave1.sql', rollback: '056_rls_rollback_wave1.sql' },
  2: { enable: '057_rls_enable_wave2.sql', rollback: '058_rls_rollback_wave2.sql' },
  3: { enable: '059_rls_enable_wave3.sql', rollback: '060_rls_rollback_wave3.sql' },
  4: { enable: '061_rls_enable_wave4.sql', rollback: '062_rls_rollback_wave4.sql' },
  5: { enable: '063_rls_enable_wave5.sql', rollback: '064_rls_rollback_wave5.sql' },
  6: { enable: '065_rls_enable_wave6.sql', rollback: '066_rls_rollback_wave6.sql' },
  7: { enable: '067_rls_enable_wave7.sql', rollback: '068_rls_rollback_wave7.sql' },
  8: { enable: '069_rls_enable_wave8.sql', rollback: '070_rls_rollback_wave8.sql' },
  9: { enable: '071_rls_enable_wave9.sql', rollback: '072_rls_rollback_wave9.sql' },
  10: { enable: '073_rls_enable_wave10.sql', rollback: '074_rls_rollback_wave10.sql' },
  11: { enable: '075_rls_enable_wave11.sql', rollback: '076_rls_rollback_wave11.sql' },
  12: { enable: '077_rls_enable_wave12.sql', rollback: '078_rls_rollback_wave12.sql' },
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const execute = process.argv.includes('--execute');
const rollback = process.argv.includes('--rollback');
const fromArg = process.argv.find((a) => a.startsWith('--from'));
const toArg = process.argv.find((a) => a.startsWith('--to'));
const fromWave = fromArg ? Number(fromArg.split('=')[1] ?? process.argv[process.argv.indexOf(fromArg) + 1]) : 1;
const toWave = toArg ? Number(toArg.split('=')[1] ?? process.argv[process.argv.indexOf(toArg) + 1]) : 12;

function assertCanExecute() {
  if (!execute) return;
  if (process.env.CONFIRM_PRODUCTION_RLS_ROLLOUT !== 'true') {
    throw new Error('Defina CONFIRM_PRODUCTION_RLS_ROLLOUT=true para aplicar RLS em produção.');
  }
}

function readMigration(file) {
  return fs.readFileSync(path.join(repoRoot, 'supabase', 'migrations', file), 'utf8');
}

async function auditSummary(client) {
  const { rows } = await client.query(`
    SELECT
      COUNT(*) FILTER (WHERE has_workspace_id) AS tenant_tables,
      COUNT(*) FILTER (WHERE has_workspace_id AND rls_enabled) AS rls_enabled_tenant,
      COUNT(*) FILTER (WHERE has_workspace_id AND NOT rls_enabled) AS rls_disabled_tenant
    FROM (
      SELECT
        c.table_name,
        bool_or(c.column_name = 'workspace_id') AS has_workspace_id,
        COALESCE(pc.relrowsecurity, false) AS rls_enabled
      FROM information_schema.columns c
      JOIN pg_class pc ON pc.relname = c.table_name
      JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = c.table_schema
      WHERE c.table_schema = 'public' AND pc.relkind = 'r'
      GROUP BY c.table_name, pc.relrowsecurity
    ) t
  `);
  const rollout = (
    await client.query(`
      SELECT desired_state, COUNT(*)::int AS n
      FROM public.rls_rollout_control
      GROUP BY desired_state
      ORDER BY desired_state
    `)
  ).rows;
  return { ...rows[0], rollout_states: rollout };
}

const dbUrl = resolveProductionDbUrl(repoRoot);
assertProductionTarget(dbUrl);

const waveNumbers = Object.keys(WAVES)
  .map(Number)
  .filter((n) => n >= fromWave && n <= toWave)
  .sort((a, b) => a - b);

console.log(
  JSON.stringify(
    {
      mode: execute ? (rollback ? 'execute-rollback' : 'execute') : 'dry-run',
      target: 'production',
      waves: waveNumbers.map((n) => ({ wave: n, migration: rollback ? WAVES[n].rollback : WAVES[n].enable })),
      notes: [
        'Backend com service_role continua bypassando RLS.',
        'Após --execute, rode: npm run prod:audit:rls',
        'Rollback por wave: node scripts/db/apply-rls-wave.mjs --wave N --rollback --execute (dev URL apenas).',
      ],
    },
    null,
    2,
  ),
);

assertCanExecute();

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  const before = await auditSummary(client);
  console.log(JSON.stringify({ audit_before: before }, null, 2));

  if (!execute) {
    console.log('DRY_RUN_ONLY');
    process.exit(0);
  }

  for (const wave of waveNumbers) {
    const migrationFile = rollback ? WAVES[wave].rollback : WAVES[wave].enable;
    const sql = readMigration(migrationFile);
    await client.query('BEGIN');
    try {
      await execSqlStatements(client, sql);
      await client.query('COMMIT');
      console.log(`Applied wave ${wave}: ${migrationFile}`);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new Error(`Falha na wave ${wave} (${migrationFile}): ${e?.message || e}`);
    }
  }

  if (!rollback) {
    await client.query(`
      UPDATE public.rls_rollout_control
      SET desired_state = 'enabled_production', updated_at = now()
      WHERE desired_state = 'enabled_staging'
    `);
    console.log('Updated rls_rollout_control → enabled_production');
  }

  const after = await auditSummary(client);
  console.log(JSON.stringify({ ok: true, audit_after: after }, null, 2));
} finally {
  await client.end();
}
