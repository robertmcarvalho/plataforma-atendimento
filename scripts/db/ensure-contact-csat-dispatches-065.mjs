#!/usr/bin/env node
/**
 * Aplica migração 065 (contact_csat_dispatches + csat_score).
 * Uso: node scripts/db/ensure-contact-csat-dispatches-065.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { readDbUrl } from '../lib/readDbUrl.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sqlPath = path.join(repoRoot, 'supabase', 'migrations', '065_contact_csat_dispatches.sql');

const client = new Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });

async function main() {
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await client.connect();
  try {
    await client.query(sql);
    console.log('OK: migração 065 aplicada (contact_csat_dispatches).');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
