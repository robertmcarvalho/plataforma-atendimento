#!/usr/bin/env node
/**
 * Aplica 048_commercial_rls_service_role.sql em produção (omhlb).
 *   $env:CONFIRM_PRODUCTION_MIGRATION_048="true"
 *   node scripts/apply-migration-048-commercial-rls.mjs --execute
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { execSqlStatements } from '../lib/execSqlStatements.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const execute = process.argv.includes('--execute');
const urlFile = path.join(repoRoot, '.secrets', 'production-db-url.txt');
const sqlPath = path.join(repoRoot, 'supabase', 'migrations', '048_commercial_rls_service_role.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const dbUrl = fs.readFileSync(urlFile, 'utf8').trim();

if (!dbUrl.includes('omhlbavfsttwcnybzvcd')) {
  console.error('Bloqueado: production-db-url deve ser omhlb');
  process.exit(1);
}

console.log(JSON.stringify({ mode: execute ? 'execute' : 'dry-run', migration: '048_commercial_rls_service_role.sql' }, null, 2));

if (!execute) {
  console.log('Dry-run. Use --execute com CONFIRM_PRODUCTION_MIGRATION_048=true');
  process.exit(0);
}

if (process.env.CONFIRM_PRODUCTION_MIGRATION_048 !== 'true') {
  console.error('Defina CONFIRM_PRODUCTION_MIGRATION_048=true');
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await execSqlStatements(client, sql);
  console.log(JSON.stringify({ ok: true }, null, 2));
} finally {
  await client.end();
}
