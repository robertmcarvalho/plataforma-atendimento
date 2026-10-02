#!/usr/bin/env node
import { Client } from 'pg';
import { readDbUrl } from '../lib/readDbUrl.mjs';

const client = new Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'inbox_notifications_seen_at'`
  );
  const csat = await client.query(`SELECT to_regclass('public.contact_csat_dispatches') AS reg`);
  console.log(JSON.stringify({ inbox_notifications_seen_at: cols.rowCount > 0, contact_csat_dispatches: Boolean(csat.rows[0]?.reg) }, null, 2));
} finally {
  await client.end();
}
