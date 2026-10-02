/**
 * Read-only: reports Supabase project ref fingerprint and key migration markers.
 * Usage: node scripts/check-db-migration-state.mjs [--url-file .secrets/supabase-db-url.txt]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const urlFileArg = process.argv.indexOf('--url-file');
const urlFile =
  urlFileArg >= 0 ? process.argv[urlFileArg + 1] : path.join(repoRoot, '.secrets', 'supabase-db-url.txt');

let dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '';
if (!dbUrl && fs.existsSync(urlFile)) dbUrl = fs.readFileSync(urlFile, 'utf8').trim();
if (!dbUrl) {
  console.error('No DB URL. Set SUPABASE_DB_URL or --url-file');
  process.exit(1);
}

function refFromUrl(url) {
  try {
    const host = new URL(url).hostname;
    const m = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
    if (m) return m[1];
    if (host.includes('pooler.supabase.com')) return '(pooler — check project in Supabase dashboard)';
    return host;
  } catch {
    return '(unparsed)';
  }
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const markers = {};
  for (const [key, sql] of Object.entries({
    rate_limit_buckets_038: `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'rate_limit_buckets'
    ) AS ok`,
    workspace_governance_index: `SELECT EXISTS (
      SELECT 1 FROM pg_indexes WHERE indexname LIKE '%workspace%'
    ) AS ok`,
    pending_tasks: `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'pending_tasks'
    ) AS ok`,
    leader_whatsapp_verifications_032: `SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'leader_whatsapp_verifications'
    ) AS ok`,
  })) {
    const { rows } = await client.query(sql);
    markers[key] = Boolean(rows[0]?.ok);
  }

  let migrations = [];
  try {
    const { rows } = await client.query(
      `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 20`
    );
    migrations = rows.map((r) => r.version);
  } catch {
    migrations = ['(schema_migrations not available — use Supabase dashboard)'];
  }

  console.log(
    JSON.stringify(
      {
        url_file: urlFile,
        host_fingerprint: refFromUrl(dbUrl),
        markers,
        recent_migrations: migrations,
      },
      null,
      2
    )
  );
} finally {
  await client.end();
}
