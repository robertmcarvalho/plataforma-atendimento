#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { resolveProductionDbUrl, assertProductionTarget, loadProductionApiEnv } from './lib/loadProdEnv.mjs';

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_DB_URL;
loadProductionApiEnv();
const connectionString = resolveProductionDbUrl();
assertProductionTarget(connectionString);

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

const tables = ['users', 'leaders', 'conversations', 'contacts', 'drivers', 'pharmacies'];
const counts = {};
for (const table of tables) {
  const r = await client.query(`SELECT COUNT(*)::int AS c FROM public.${table}`);
  counts[table] = r.rows[0].c;
}
const testUsers = await client.query(
  `SELECT COUNT(*)::int AS c FROM public.users
   WHERE email ILIKE '%@fluxfarma.local%' OR email ILIKE '%@rhcoopmob.dev%' OR email ILIKE 'dev-admin@%'`
);
counts.test_users_pattern = testUsers.rows[0].c;
await client.end();

const out = { at: new Date().toISOString(), ref: 'ojzzxqqatqncchnspkch', counts };
mkdirSync(join(process.cwd(), 'reports'), { recursive: true });
writeFileSync(join(process.cwd(), 'reports', 'pre-cleanup-prod-snapshot.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
