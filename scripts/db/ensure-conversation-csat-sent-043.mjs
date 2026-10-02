/**
 * Aplica migração 043 (conversations.csat_sent_at).
 *
 * Usage: node scripts/ensure-conversation-csat-sent-043.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { readDbUrl } from '../lib/readDbUrl.mjs';
import { execSqlStatements } from '../lib/execSqlStatements.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sqlPath = path.join(repoRoot, 'supabase', 'migrations', '043_conversation_csat_sent.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

const dbUrl = readDbUrl();
const host = (() => {
  try {
    return new URL(dbUrl).host;
  } catch {
    return '(unparsed)';
  }
})();

console.log(JSON.stringify({ migration: '043_conversation_csat_sent.sql', host }, null, 2));

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('begin');
  await execSqlStatements(client, sql);
  await client.query('commit');
  console.log('OK: migração 043 aplicada (conversations.csat_sent_at).');
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  throw e;
} finally {
  await client.end();
}
