import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Client } = require('pg');

function readDbUrl() {
  const envUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (envUrl) return envUrl.trim();

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(scriptDir, '..');
  const secretPath = path.join(root, '.secrets', 'supabase-db-url.txt');
  if (fs.existsSync(secretPath)) {
    const value = fs.readFileSync(secretPath, 'utf8').trim();
    if (value) return value;
  }

  throw new Error('Missing SUPABASE_DB_URL (or .secrets/supabase-db-url.txt).');
}

async function main() {
  const connectionString = readDbUrl();

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query('begin');

    // 006: Pix Key
    await client.query(`
      ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS pix_key text;
    `);

    // 007: Supply Requests
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.supply_requests (
        id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        leader_id         uuid NOT NULL REFERENCES public.leaders(id) ON DELETE CASCADE,
        driver_id         uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
        pharmacy_id       uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
        item_type         text NOT NULL,
        size              text,
        status            text NOT NULL DEFAULT 'pending',
        tracking_link     text,
        expected_delivery date,
        delivered_at      timestamptz,
        financial_entry_id uuid REFERENCES public.financial_entries(id) ON DELETE SET NULL,
        created_at        timestamptz NOT NULL DEFAULT now(),
        updated_at        timestamptz NOT NULL DEFAULT now()
      );
    `);

    // Add function if it doesn't exist
    await client.query(`
      CREATE OR REPLACE FUNCTION public.update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);

    // Add trigger if it doesn't exist
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'tr_supply_requests_updated_at') THEN
          CREATE TRIGGER tr_supply_requests_updated_at BEFORE UPDATE ON public.supply_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
        END IF;
      END $$;
    `);

    await client.query('commit');
    console.log('DB_ENSURE_007_OK');
  } catch (err) {
    try {
      await client.query('rollback');
    } catch {
      // ignore
    }
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
