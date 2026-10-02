/**
 * Recarrega o cache de schema do PostgREST (Supabase API).
 *
 *   node scripts/reload-postgrest-schema.mjs --url-file .secrets/production-db-url.txt
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const urlFileArg = process.argv.indexOf('--url-file');
const urlFile =
  urlFileArg >= 0
    ? path.resolve(process.argv[urlFileArg + 1])
    : path.join(repoRoot, '.secrets', 'production-db-url.txt');

let dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '';
if (!dbUrl && fs.existsSync(urlFile)) dbUrl = fs.readFileSync(urlFile, 'utf8').trim();
if (!dbUrl) {
  console.error('Missing SUPABASE_DB_URL or --url-file');
  process.exit(1);
}

const host = (() => {
  try {
    return new URL(dbUrl).host;
  } catch {
    return '(unparsed)';
  }
})();

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(`NOTIFY pgrst, 'reload schema'`);
  console.log(JSON.stringify({ ok: true, host, message: 'PostgREST schema reload notified' }, null, 2));
} catch (e) {
  console.error(JSON.stringify({ ok: false, host, error: e instanceof Error ? e.message : String(e) }, null, 2));
  process.exit(1);
} finally {
  await client.end();
}
