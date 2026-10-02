/**
 * Apply migration 037_conversations_workspace_channel.sql (conversations.workspace_channel_id).
 *
 * Usage (produção — omhlb):
 *   node scripts/apply-migration-037.mjs --url-file .secrets/production-db-url.txt
 *   $env:CONFIRM_PRODUCTION_MIGRATION_037="true"
 *   node scripts/apply-migration-037.mjs --url-file .secrets/production-db-url.txt --execute
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

const sqlPath = path.join(repoRoot, 'supabase', 'migrations', '037_conversations_workspace_channel.sql');
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
      migration: '037_conversations_workspace_channel.sql',
      host,
      url_file: urlFile,
      production_ref_expected: PROD_REF,
    },
    null,
    2,
  ),
);

if (!execute) {
  console.log('Dry-run only. Pass --execute with CONFIRM_PRODUCTION_MIGRATION_037=true');
  process.exit(0);
}

if (process.env.CONFIRM_PRODUCTION_MIGRATION_037 !== 'true') {
  console.error('Blocked: set CONFIRM_PRODUCTION_MIGRATION_037=true');
  process.exit(1);
}

if (!dbUrl.toLowerCase().includes(PROD_REF)) {
  console.error(
    `Blocked: URL does not contain production ref ${PROD_REF}. Set ALLOW_NON_PROD_MIGRATION_037=true after manual review.`,
  );
  if (process.env.ALLOW_NON_PROD_MIGRATION_037 !== 'true') process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const { rows: before } = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'conversations'
        AND column_name = 'workspace_channel_id'
    ) AS ok`,
  );
  if (before[0]?.ok) {
    console.log('SKIP: conversations.workspace_channel_id already exists');
    process.exit(0);
  }

  await client.query('begin');
  await execSqlStatements(client, sql);
  await client.query('commit');
  console.log('OK migration 037 applied');

  const { rows: after } = await client.query(
    `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'conversations'
        AND column_name = 'workspace_channel_id'
    ) AS ok`,
  );
  console.log(JSON.stringify({ conversations_workspace_channel_id: Boolean(after[0]?.ok) }, null, 2));
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  throw e;
} finally {
  await client.end();
}
