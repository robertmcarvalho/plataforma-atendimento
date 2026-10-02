#!/usr/bin/env node
/**
 * Aplica migrações pendentes: 065 (CSAT), 079 (OOH copy), 080 (inbox notifications seen_at).
 * Uso: node scripts/db/ensure-pending-inbox-migrations-065-080.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { readDbUrl } from '../lib/readDbUrl.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migrations = [
  '065_contact_csat_dispatches.sql',
  '079_out_of_hours_message_v2.sql',
  '080_inbox_notifications_seen_at.sql',
];

const client = new Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  try {
    for (const file of migrations) {
      const sqlPath = path.join(repoRoot, 'supabase', 'migrations', file);
      const sql = fs.readFileSync(sqlPath, 'utf8');
      console.log(`Applying ${file}...`);
      await client.query(sql);
      console.log(`OK: ${file}`);
    }
    console.log('All pending inbox migrations applied.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
