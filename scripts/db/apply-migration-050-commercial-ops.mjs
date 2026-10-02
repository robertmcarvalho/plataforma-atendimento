#!/usr/bin/env node
/**
 * Apply migration 050_commercial_roles_and_ops.sql
 * Usage: node scripts/apply-migration-050-commercial-ops.mjs [--execute]
 */
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const execute = process.argv.includes('--execute');

const sqlPath = path.join(root, 'supabase/migrations/050_commercial_roles_and_ops.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('Defina DATABASE_URL ou SUPABASE_DB_URL');
  process.exit(1);
}

if (!execute) {
  console.log('Dry-run. SQL length:', sql.length, 'chars');
  console.log('Execute with: node scripts/apply-migration-050-commercial-ops.mjs --execute');
  process.exit(0);
}

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();
try {
  await client.query(sql);
  console.log('Migration 050 aplicada com sucesso.');
} finally {
  await client.end();
}
