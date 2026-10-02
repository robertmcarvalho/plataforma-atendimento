#!/usr/bin/env node
/**
 * Apply migration 053_commercial_proposal_document.sql
 * Usage: node scripts/apply-migration-053-commercial-proposal-document.mjs [--execute]
 */
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { readDbUrl } from '../lib/readDbUrl.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const execute = process.argv.includes('--execute');

const sqlPath = path.join(root, 'supabase/migrations/053_commercial_proposal_document.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

if (!execute) {
  console.log('Dry-run. SQL length:', sql.length, 'chars');
  console.log('Execute with: node scripts/apply-migration-053-commercial-proposal-document.mjs --execute');
  process.exit(0);
}

const client = new pg.Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(sql);
  const { rows } = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'commercial_proposals'
      AND column_name IN ('document_html', 'document_saved_at')
    ORDER BY column_name
  `);
  console.log('Migration 053 aplicada. Colunas:', rows.map((r) => r.column_name).join(', ') || '(nenhuma nova — já existiam?)');
} finally {
  await client.end();
}
