#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs';
import pg from 'pg';

const legacyUrl = existsSync('.secrets/legacy-db-url.txt')
  ? readFileSync('.secrets/legacy-db-url.txt', 'utf8').trim()
  : null;
const prodUrl = readFileSync('.secrets/production-db-url.txt', 'utf8').trim();

async function audit(label, url) {
  const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const ws = (await c.query(`SELECT id FROM workspaces WHERE slug='default' LIMIT 1`)).rows[0]?.id;
  const q = async (sql) => (await c.query(sql, [ws])).rows[0];
  const stats = {
    total: (await q(`SELECT COUNT(*)::int c FROM pharmacies WHERE workspace_id=$1`)).c,
    with_primary_attendant: (await q(`SELECT COUNT(*)::int c FROM pharmacies WHERE workspace_id=$1 AND primary_attendant_id IS NOT NULL`)).c,
    with_delivery_fee: (await q(`SELECT COUNT(*)::int c FROM pharmacies WHERE workspace_id=$1 AND delivery_fee_cents IS NOT NULL`)).c,
    with_delivery_schedule: (
      await q(`SELECT COUNT(*)::int c FROM pharmacies WHERE workspace_id=$1 AND delivery_schedule IS NOT NULL AND delivery_schedule::text <> '{}'`)
    ).c,
    with_contact_expedition: (await q(`SELECT COUNT(*)::int c FROM pharmacies WHERE workspace_id=$1 AND contact_expedition_name IS NOT NULL`)).c,
    with_address_cep: (await q(`SELECT COUNT(*)::int c FROM pharmacies WHERE workspace_id=$1 AND address_cep IS NOT NULL AND trim(address_cep)<>''`)).c,
    sector_attendants: (await q(`SELECT COUNT(*)::int c FROM pharmacy_sector_attendants psa JOIN pharmacies p ON p.id=psa.pharmacy_id WHERE p.workspace_id=$1`)).c,
  };
  const sample = await c.query(
    `SELECT trade_name, cnpj, primary_attendant_id IS NOT NULL AS has_att,
            delivery_fee_cents, delivery_schedule::text <> '{}' AS has_sched,
            contact_expedition_name IS NOT NULL AS has_contact
     FROM pharmacies WHERE workspace_id=$1 ORDER BY updated_at DESC NULLS LAST LIMIT 5`,
    [ws]
  );
  await c.end();
  return { label, stats, sample: sample.rows };
}

const out = { prod: await audit('prod', prodUrl) };
if (legacyUrl?.includes('ojzzx')) {
  try {
    out.legacy = await audit('legacy', legacyUrl);
  } catch (e) {
    out.legacy = { error: e.message };
  }
}
console.log(JSON.stringify(out, null, 2));
