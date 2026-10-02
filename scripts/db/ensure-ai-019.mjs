/**
 * Aplica migration 019_ai_analysis.sql.
 * Habilita pgvector e cria colunas ai_* em messages/conversations + tabela ai_topics.
 * Uso: npm run db:ensure:ai019
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { readDbUrl } from '../lib/readDbUrl.mjs';
import { execSqlStatements } from '../lib/execSqlStatements.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '019_ai_analysis.sql'), 'utf8');

const client = new pg.Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('begin');
  await execSqlStatements(client, sql);
  await client.query('commit');
  console.log('OK: 019_ai_analysis.sql aplicada (idempotente).');
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  console.error(e?.message || e);
  process.exit(1);
} finally {
  await client.end();
}
