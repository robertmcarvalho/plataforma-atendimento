#!/usr/bin/env node
/**
 * Aplica a função repair_auth_user_null_tokens em produção (uma vez).
 *   CONFIRM_PROD_AUTH_REPAIR=true node scripts/apply-auth-repair-rpc-prod.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { assertProductionTarget } from '../lib/loadProdEnv.mjs';

if (process.env.CONFIRM_PROD_AUTH_REPAIR !== 'true') {
  throw new Error('Defina CONFIRM_PROD_AUTH_REPAIR=true');
}

const sql = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations', '040_repair_auth_user_null_tokens.sql'),
  'utf8'
);

const dbUrl = readFileSync('.secrets/production-db-url.txt', 'utf8').trim();
assertProductionTarget(dbUrl);

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(sql);
await client.end();
console.log(JSON.stringify({ ok: true, applied: '040_repair_auth_user_null_tokens' }, null, 2));
