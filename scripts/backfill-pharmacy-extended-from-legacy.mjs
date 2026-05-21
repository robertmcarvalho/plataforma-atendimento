#!/usr/bin/env node
/**
 * Copia campos estendidos de farmácias (ojzzx → omhlb) omitidos na migração inicial.
 *
 *   node scripts/backfill-pharmacy-extended-from-legacy.mjs
 *   $env:CONFIRM_PHARMACY_BACKFILL="true"
 *   node scripts/backfill-pharmacy-extended-from-legacy.mjs --execute
 */
import { readFileSync, existsSync } from 'fs';
import pg from 'pg';
import { LEGACY_REF, PROD_REF, assertRef } from './lib/migrateLegacyDb.mjs';

const execute = process.argv.includes('--execute');
if (execute && process.env.CONFIRM_PHARMACY_BACKFILL !== 'true') {
  throw new Error('Defina CONFIRM_PHARMACY_BACKFILL=true');
}

const legacyUrl = readFileSync('.secrets/legacy-db-url.txt', 'utf8').trim();
const prodUrl = readFileSync('.secrets/production-db-url.txt', 'utf8').trim();
assertRef(legacyUrl, LEGACY_REF, 'legacy');
assertRef(prodUrl, PROD_REF, 'prod');

const PHARMACY_COPY_COLS = [
  'legal_name',
  'trade_name',
  'city',
  'state',
  'phone',
  'email',
  'status',
  'notes',
  'tags',
  'address_cep',
  'address_street',
  'address_number',
  'address_neighborhood',
  'address_complement',
  'contact_expedition_name',
  'contact_expedition_phone',
  'contact_expedition_email',
  'contact_financial_name',
  'contact_financial_phone',
  'contact_financial_email',
  'contact_manager_name',
  'contact_manager_phone',
  'contact_manager_email',
  'delivery_fee_cents',
  'delivery_fee_driver_payout_cents',
  'minimum_guaranteed_cents',
  'minimum_guaranteed_driver_payout_cents',
  'delivery_schedule',
];

const src = new pg.Client({ connectionString: legacyUrl, ssl: { rejectUnauthorized: false } });
const dst = new pg.Client({ connectionString: prodUrl, ssl: { rejectUnauthorized: false } });
await src.connect();
await dst.connect();

async function workspaceId(client) {
  return (await client.query(`SELECT id FROM workspaces WHERE slug='default' LIMIT 1`)).rows[0]?.id;
}

const srcWs = await workspaceId(src);
const prodWs = await workspaceId(dst);

async function buildUserIdMap() {
  const map = new Map();
  const { rows } = await src.query(
    `SELECT u.id AS legacy_id, lower(u.email) AS email
     FROM public.users u WHERE u.email IS NOT NULL`
  );
  for (const row of rows) {
    const prod = await dst.query(`SELECT id FROM public.users WHERE lower(email) = $1 LIMIT 1`, [row.email]);
    if (prod.rows[0]?.id) map.set(row.legacy_id, prod.rows[0].id);
  }
  return map;
}

async function buildLeaderIdMap() {
  const map = new Map();
  const { rows } = await src.query(`SELECT id, phone FROM leaders WHERE workspace_id = $1`, [srcWs]);
  for (const row of rows) {
    const prod = await dst.query(`SELECT id FROM leaders WHERE workspace_id = $1 AND phone = $2`, [prodWs, row.phone]);
    if (prod.rows[0]?.id) map.set(row.id, prod.rows[0].id);
  }
  return map;
}

const userMap = await buildUserIdMap();
const leaderMap = await buildLeaderIdMap();

const legacyPharmacies = await src.query(
  `SELECT * FROM pharmacies WHERE workspace_id = $1 AND cnpj IS NOT NULL AND trim(cnpj) <> ''`,
  [srcWs]
);

const plan = {
  execute,
  legacy_pharmacies: legacyPharmacies.rows.length,
  would_update: 0,
  with_attendant: 0,
  with_commercial: 0,
  with_schedule: 0,
  with_contacts: 0,
  sector_attendants: 0,
  samples: [],
};

for (const row of legacyPharmacies.rows) {
  const prodRow = await dst.query(`SELECT id FROM pharmacies WHERE workspace_id = $1 AND cnpj = $2`, [prodWs, row.cnpj]);
  const prodId = prodRow.rows[0]?.id;
  if (!prodId) continue;

  const primary_attendant_id = row.primary_attendant_id ? userMap.get(row.primary_attendant_id) || null : null;
  const secondary_attendant_id = row.secondary_attendant_id ? userMap.get(row.secondary_attendant_id) || null : null;
  const leader_id = row.leader_id ? leaderMap.get(row.leader_id) || null : null;

  const hasCommercial =
    row.delivery_fee_cents != null ||
    row.minimum_guaranteed_cents != null ||
    (row.delivery_schedule && JSON.stringify(row.delivery_schedule) !== '{}');
  const hasSchedule = row.delivery_schedule && JSON.stringify(row.delivery_schedule) !== '{}';
  const hasContact =
    row.contact_expedition_name || row.contact_financial_name || row.contact_manager_name;
  if (primary_attendant_id) plan.with_attendant++;
  if (hasCommercial) plan.with_commercial++;
  if (hasSchedule) plan.with_schedule++;
  if (hasContact) plan.with_contacts++;
  plan.would_update++;

  if (plan.samples.length < 3 && (primary_attendant_id || hasCommercial)) {
    plan.samples.push({ cnpj: row.cnpj, trade_name: row.trade_name, primary_attendant_id, hasCommercial });
  }

  if (!execute) continue;

  const setParts = PHARMACY_COPY_COLS.map((c, i) => `${c} = $${i + 2}`).join(', ');
  const vals = PHARMACY_COPY_COLS.map((c) => row[c]);
  await dst.query(
    `UPDATE pharmacies SET ${setParts},
      primary_attendant_id = $${PHARMACY_COPY_COLS.length + 2},
      secondary_attendant_id = $${PHARMACY_COPY_COLS.length + 3},
      leader_id = $${PHARMACY_COPY_COLS.length + 4},
      updated_at = now()
     WHERE id = $1`,
    [prodId, ...vals, primary_attendant_id, secondary_attendant_id, leader_id]
  );

  const psa = await src.query(`SELECT * FROM pharmacy_sector_attendants WHERE pharmacy_id = $1`, [row.id]);
  for (const link of psa.rows) {
    const attendantId = userMap.get(link.attendant_id);
    const byName = await src.query(`SELECT name FROM sectors WHERE id = $1`, [link.sector_id]);
    const name = byName.rows[0]?.name;
    if (!attendantId || !name) continue;
    const ex = await dst.query(`SELECT id FROM sectors WHERE workspace_id = $1 AND name = $2`, [prodWs, name]);
    const sectorId = ex.rows[0]?.id;
    if (!sectorId) continue;
    await dst.query(
      `INSERT INTO pharmacy_sector_attendants (pharmacy_id, sector_id, attendant_id, created_at, updated_at)
       VALUES ($1,$2,$3,COALESCE($4,now()),now())
       ON CONFLICT (pharmacy_id, sector_id) DO UPDATE SET attendant_id = EXCLUDED.attendant_id, updated_at = now()`,
      [prodId, sectorId, attendantId, link.created_at]
    );
    plan.sector_attendants++;
  }
}

if (!execute) {
  console.log(JSON.stringify({ ok: true, dryRun: true, plan }, null, 2));
  console.log('\nExecute: CONFIRM_PHARMACY_BACKFILL=true node scripts/backfill-pharmacy-extended-from-legacy.mjs --execute');
} else {
  const after = await dst.query(
    `SELECT
      COUNT(*) FILTER (WHERE primary_attendant_id IS NOT NULL)::int AS with_attendant,
      COUNT(*) FILTER (WHERE delivery_fee_cents IS NOT NULL)::int AS with_fee,
      COUNT(*) FILTER (WHERE delivery_schedule::text <> '{}')::int AS with_schedule
     FROM pharmacies WHERE workspace_id = $1`,
    [prodWs]
  );
  console.log(JSON.stringify({ ok: true, plan, prod_after: after.rows[0] }, null, 2));
}

await src.end();
await dst.end();
