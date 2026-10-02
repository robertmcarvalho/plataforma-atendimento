/**
 * Apply migration 047_commercial_crm.sql (CRM Comercial).
 *
 * Usage (produção — omhlb):
 *   node scripts/apply-migration-047.mjs --url-file .secrets/production-db-url.txt
 *   $env:CONFIRM_PRODUCTION_MIGRATION_047="true"
 *   node scripts/apply-migration-047.mjs --url-file .secrets/production-db-url.txt --execute
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { execSqlStatements } from '../lib/execSqlStatements.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const execute = process.argv.includes('--execute');
const urlFileArg = process.argv.indexOf('--url-file');
const urlFile =
  urlFileArg >= 0
    ? path.resolve(process.argv[urlFileArg + 1])
    : path.join(repoRoot, '.secrets', 'production-db-url.txt');

let dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '';
if (!dbUrl && fs.existsSync(urlFile)) dbUrl = fs.readFileSync(urlFile, 'utf8').trim();
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL. Set env or --url-file .secrets/production-db-url.txt');
  process.exit(1);
}

const sqlPath = path.join(repoRoot, 'supabase', 'migrations', '047_commercial_crm.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

const host = (() => {
  try {
    return new URL(dbUrl).host;
  } catch {
    return '(unparsed)';
  }
})();

const PROD_REF = 'omhlbavfsttwcnybzvcd';

console.log(
  JSON.stringify(
    {
      mode: execute ? 'execute' : 'dry-run',
      migration: '047_commercial_crm.sql',
      host,
      url_file: urlFile,
      production_ref_expected: PROD_REF,
    },
    null,
    2,
  ),
);

if (!execute) {
  console.log('Dry-run only. Pass --execute with CONFIRM_PRODUCTION_MIGRATION_047=true');
  process.exit(0);
}

if (process.env.CONFIRM_PRODUCTION_MIGRATION_047 !== 'true') {
  console.error('Blocked: set CONFIRM_PRODUCTION_MIGRATION_047=true');
  process.exit(1);
}

if (!dbUrl.toLowerCase().includes(PROD_REF)) {
  console.error(
    `Blocked: URL does not contain production ref ${PROD_REF}. Set ALLOW_NON_PROD_MIGRATION_047=true after manual review.`,
  );
  if (process.env.ALLOW_NON_PROD_MIGRATION_047 !== 'true') process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const { rows: before } = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'commercial_leads'
    ) AS ok`,
  );
  if (before[0]?.ok) {
    console.log('SKIP: commercial_leads already exists');
    process.exit(0);
  }

  await client.query('begin');
  await execSqlStatements(client, sql);
  await client.query('commit');
  console.log('OK migration 047 applied');

  const { rows: tables } = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name LIKE 'commercial_%'
     ORDER BY 1`,
  );
  const { rows: cols } = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'conversations'
       AND column_name = 'context_commercial_lead_id'`,
  );
  console.log(
    JSON.stringify(
      {
        commercial_tables: tables.map((r) => r.table_name),
        conversations_context_commercial_lead_id: cols.length > 0,
      },
      null,
      2,
    ),
  );
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  throw e;
} finally {
  await client.end();
}
