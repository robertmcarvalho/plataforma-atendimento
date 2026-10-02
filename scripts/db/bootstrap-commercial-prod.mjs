#!/usr/bin/env node
/**
 * Bootstrap CRM Comercial em produção: migrations 050/051 + seed pipeline/motor + flag.
 *
 *   $env:CONFIRM_PRODUCTION_COMMERCIAL_BOOTSTRAP="true"
 *   node scripts/bootstrap-commercial-prod.mjs --execute
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import pg from 'pg';
import { execSqlStatements } from '../lib/execSqlStatements.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execute = process.argv.includes('--execute');
const urlFile = path.join(repoRoot, '.secrets', 'production-db-url.txt');
const PROD_REF = 'omhlbavfsttwcnybzvcd';

let dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '';
if (!dbUrl && fs.existsSync(urlFile)) dbUrl = fs.readFileSync(urlFile, 'utf8').trim();

if (!dbUrl) {
  console.error('Missing DB URL (.secrets/production-db-url.txt)');
  process.exit(1);
}

const migrations = [
  { id: '050', file: '050_commercial_roles_and_ops.sql', check: 'operational_snapshot on commercial_leads' },
  { id: '051', file: '051_commercial_lead_optional_fields.sql', check: 'cnpj nullable on commercial_leads' },
];

console.log(JSON.stringify({ mode: execute ? 'execute' : 'dry-run', host: new URL(dbUrl).host }, null, 2));

if (!execute) {
  console.log('Dry-run. Pass --execute with CONFIRM_PRODUCTION_COMMERCIAL_BOOTSTRAP=true');
  process.exit(0);
}

if (process.env.CONFIRM_PRODUCTION_COMMERCIAL_BOOTSTRAP !== 'true') {
  console.error('Blocked: set CONFIRM_PRODUCTION_COMMERCIAL_BOOTSTRAP=true');
  process.exit(1);
}

if (!dbUrl.toLowerCase().includes(PROD_REF) && process.env.ALLOW_NON_PROD_COMMERCIAL_BOOTSTRAP !== 'true') {
  console.error(`Blocked: URL must contain ${PROD_REF}`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  for (const m of migrations) {
    let skip = false;
    if (m.id === '050') {
      const { rows } = await client.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='commercial_leads' AND column_name='operational_snapshot'`,
      );
      skip = rows.length > 0;
    }
    if (m.id === '051') {
      const { rows } = await client.query(
        `SELECT is_nullable FROM information_schema.columns
         WHERE table_schema='public' AND table_name='commercial_leads' AND column_name='cnpj'`,
      );
      skip = rows[0]?.is_nullable === 'YES';
    }
    if (skip) {
      console.log(`SKIP migration ${m.id} (${m.check} already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(repoRoot, 'supabase/migrations', m.file), 'utf8');
    await client.query('BEGIN');
    await execSqlStatements(client, sql);
    await client.query('COMMIT');
    console.log(`OK migration ${m.id}`);
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw e;
} finally {
  await client.end();
}

console.log('\n> seed commercial defaults (pipeline, fields)...');
execSync('node scripts/seed-commercial-defaults-prod.mjs', { cwd: repoRoot, stdio: 'inherit', shell: true });

console.log('\n> seed motor config + commercial_crm_enabled...');
execSync('node scripts/seed-commercial-motor-config-prod.mjs --url-file .secrets/production-db-url.txt --execute', {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, CONFIRM_PRODUCTION_COMMERCIAL_SEED: 'true' },
});

console.log('\nBootstrap comercial concluído.');
