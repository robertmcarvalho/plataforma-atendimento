#!/usr/bin/env node
/** Aplica migration 081 (realtime inbox + human_handoff_at). */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { readDbUrl } from '../lib/readDbUrl.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sql = readFileSync(path.join(repoRoot, 'supabase/migrations/081_inbox_realtime_human_handoff.sql'), 'utf8');

const client = new Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  try {
    await client.query(sql);
    console.log('Migration 081 aplicada.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
