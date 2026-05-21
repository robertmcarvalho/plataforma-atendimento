#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const urlFile = path.join(repoRoot, '.secrets', 'production-db-url.txt');
const dbUrl = process.env.SUPABASE_DB_URL || fs.readFileSync(urlFile, 'utf8').trim();

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows } = await client.query(
  `SELECT column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'pharmacies'
     AND column_name IN (
       'delivery_fee_cents',
       'delivery_fee_driver_payout_cents',
       'minimum_guaranteed_cents',
       'minimum_guaranteed_driver_payout_cents',
       'delivery_schedule'
     )
   ORDER BY column_name`,
);
console.log(JSON.stringify({ host: new URL(dbUrl).hostname, columns: rows }, null, 2));
try {
  await client.query(`NOTIFY pgrst, 'reload schema'`);
  console.log('PostgREST schema reload notified');
} catch (e) {
  console.warn('reload notify skipped:', e.message);
}
await client.end();
