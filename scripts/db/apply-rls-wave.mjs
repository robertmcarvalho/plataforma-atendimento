#!/usr/bin/env node
/**
 * Aplica migration de wave RLS com dry-run por padrão.
 *
 * Dry-run:  npm run db:apply:rls-wave1
 *            npm run db:apply:rls-wave2
 * Executar:  $env:CONFIRM_RLS_ROLLOUT="true"; node scripts/db/apply-rls-wave.mjs --wave 2 --execute
 * Rollback:  $env:CONFIRM_RLS_ROLLOUT="true"; node scripts/db/apply-rls-wave.mjs --wave 2 --execute --rollback
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { readDbUrl } from '../lib/readDbUrl.mjs';
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
const waveArg = process.argv.find((a) => a.startsWith('--wave'));
const wave = waveArg ? Number(waveArg.split('=')[1] ?? process.argv[process.argv.indexOf(waveArg) + 1]) : 1;

if (!WAVES[wave]) {
  throw new Error(`Wave inválida: ${wave}. Use --wave 1 a 12.`);
}

const migrationFile = rollback ? WAVES[wave].rollback : WAVES[wave].enable;

function assertCanExecute() {
  if (!execute) return;
  if (process.env.CONFIRM_RLS_ROLLOUT !== 'true') {
    throw new Error('Defina CONFIRM_RLS_ROLLOUT=true para aplicar wave RLS.');
  }
}

const sql = fs.readFileSync(path.join(repoRoot, 'supabase', 'migrations', migrationFile), 'utf8');

console.log(
  JSON.stringify(
    {
      mode: execute ? (rollback ? 'execute-rollback' : 'execute') : 'dry-run',
      wave,
      migration: migrationFile,
      notes: [
        'Após --execute, rode smoke RLS da wave e npm run smoke:multitenant-isolation-db',
        `Rollback wave ${wave}: --rollback com ${WAVES[wave].rollback}`,
      ],
    },
    null,
    2,
  ),
);

assertCanExecute();

if (!execute) {
  console.log('DRY_RUN_ONLY');
  process.exit(0);
}

const client = new pg.Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('BEGIN');
  await execSqlStatements(client, sql);
  await client.query('COMMIT');
  console.log(`Applied ${migrationFile}`);
} catch (e) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw e;
} finally {
  await client.end();
}
