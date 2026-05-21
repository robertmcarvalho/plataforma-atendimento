#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { Client } from 'pg';

async function snapshot(label, connectionString) {
  const c = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const out = { label };
  for (const table of ['drivers', 'leaders', 'pharmacies']) {
    const r = await c.query(`SELECT COUNT(*)::int AS c FROM public.${table}`);
    out[table] = r.rows[0].c;
  }
  out.leaders_names = (
    await c.query(`SELECT name FROM public.leaders ORDER BY name LIMIT 15`)
  ).rows.map((r) => r.name);
  await c.end();
  return out;
}

const prod = readFileSync('.secrets/production-db-url.txt', 'utf8').trim();
const dev = readFileSync('.secrets/supabase-db-url.txt', 'utf8').trim();
console.log(JSON.stringify({ prod: await snapshot('prod', prod), dev: await snapshot('dev', dev) }, null, 2));
