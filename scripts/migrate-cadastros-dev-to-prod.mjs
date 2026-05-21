#!/usr/bin/env node
/**
 * Copia cadastros (leaders, pharmacies, drivers, links) do projeto DEV → PRODUÇÃO.
 * Os imports históricos ficaram em omhlb…; a UI prod (ojzzx…) estava quase vazia + smoke.
 *
 *   npm run migrate:cadastros:dev-to-prod              # dry-run
 *   $env:CONFIRM_MIGRATE_CADASTROS_DEV_TO_PROD="true"
 *   npm run migrate:cadastros:dev-to-prod -- --execute
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const execute = process.argv.includes('--execute');
if (execute && process.env.CONFIRM_MIGRATE_CADASTROS_DEV_TO_PROD !== 'true') {
  throw new Error('Defina CONFIRM_MIGRATE_CADASTROS_DEV_TO_PROD=true para executar.');
}

const devUrl = readFileSync('.secrets/supabase-db-url.txt', 'utf8').trim();
const prodUrl = readFileSync('.secrets/production-db-url.txt', 'utf8').trim();

if (!devUrl.includes('omhlbavfsttwcnybzvcd')) {
  throw new Error('supabase-db-url.txt deve apontar para DEV (omhlb…).');
}
if (!prodUrl.includes('ojzzxqqatqncchnspkch')) {
  throw new Error('production-db-url.txt deve apontar para PROD (ojzzx…).');
}

const dev = new pg.Client({ connectionString: devUrl, ssl: { rejectUnauthorized: false } });
const prod = new pg.Client({ connectionString: prodUrl, ssl: { rejectUnauthorized: false } });

const DRIVER_FILTER = `
  NOT (COALESCE(tags, '{}') @> ARRAY['smoke-staging']::text[])
  AND name NOT ILIKE 'smoke%'
  AND name NOT ILIKE '%lider teste%'
  AND phone <> '5591999900001' AND phone <> '5534999991003'
`;

const LEADER_FILTER = `
  name NOT ILIKE 'smoke%'
  AND name NOT ILIKE '%lider teste%'
  AND (email IS NULL OR email NOT ILIKE '%@fluxfarma.local%')
  AND phone <> '5591999900001'
`;

const PHARMACY_FILTER = `
  NOT (COALESCE(tags, '{}') @> ARRAY['smoke-staging']::text[])
  AND trade_name NOT ILIKE 'smoke%'
  AND trade_name NOT ILIKE '%farmacia teste%'
  AND COALESCE(cnpj, '') <> '12345678000195'
  AND cnpj IS NOT NULL AND trim(cnpj) <> ''
`;

async function workspaceId(client, slug = 'default') {
  const r = await client.query(`SELECT id FROM public.workspaces WHERE slug = $1 LIMIT 1`, [slug]);
  return r.rows[0]?.id || null;
}

await dev.connect();
await prod.connect();

const devWs = await workspaceId(dev);
const prodWs = await workspaceId(prod);
if (!devWs || !prodWs) throw new Error('Workspace default ausente em dev ou prod.');

const plan = { dev_workspace_id: devWs, prod_workspace_id: prodWs, execute, counts: {} };

const devLeaders = await dev.query(
  `SELECT * FROM public.leaders WHERE workspace_id = $1 AND ${LEADER_FILTER} ORDER BY name`,
  [devWs]
);
const devPharmacies = await dev.query(
  `SELECT * FROM public.pharmacies WHERE workspace_id = $1 AND ${PHARMACY_FILTER} ORDER BY trade_name`,
  [devWs]
);
const devDrivers = await dev.query(
  `SELECT * FROM public.drivers WHERE workspace_id = $1 AND ${DRIVER_FILTER} ORDER BY name`,
  [devWs]
);

plan.counts = {
  leaders: devLeaders.rows.length,
  pharmacies: devPharmacies.rows.length,
  drivers: devDrivers.rows.length,
};

if (!execute) {
  plan.sample_leaders = devLeaders.rows.slice(0, 5).map((r) => r.name);
  plan.sample_pharmacies = devPharmacies.rows.slice(0, 5).map((r) => r.trade_name);
  console.log(JSON.stringify({ ok: true, dryRun: true, plan }, null, 2));
  await dev.end();
  await prod.end();
  process.exit(0);
}

const leaderIdMap = new Map();
const pharmacyIdMap = new Map();

try {
  await prod.query('BEGIN');

  for (const row of devLeaders.rows) {
    const ins = await prod.query(
      `INSERT INTO public.leaders (
        workspace_id, name, phone, email, city, state, status, notes, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,now()),now())
      ON CONFLICT (workspace_id, phone) DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        status = EXCLUDED.status,
        updated_at = now()
      RETURNING id`,
      [
        prodWs,
        row.name,
        row.phone,
        row.email,
        row.city,
        row.state,
        row.status,
        row.notes,
        row.created_at,
      ]
    );
    let prodId = ins.rows[0]?.id;
    if (!prodId) {
      const existing = await prod.query(
        `SELECT id FROM public.leaders WHERE workspace_id = $1 AND phone = $2 LIMIT 1`,
        [prodWs, row.phone]
      );
      prodId = existing.rows[0]?.id;
    }
    if (prodId) leaderIdMap.set(row.id, prodId);
  }

  for (const row of devPharmacies.rows) {
    const leaderId = row.leader_id ? leaderIdMap.get(row.leader_id) || null : null;
    let prodId = null;
    if (row.cnpj) {
      const existing = await prod.query(
        `SELECT id FROM public.pharmacies WHERE workspace_id = $1 AND cnpj = $2 LIMIT 1`,
        [prodWs, row.cnpj]
      );
      prodId = existing.rows[0]?.id;
    }
    if (prodId) {
      await prod.query(
        `UPDATE public.pharmacies SET
          legal_name = $2, trade_name = $3, city = $4, state = $5, phone = $6, email = $7,
          status = $8, leader_id = $9, notes = $10, tags = $11, updated_at = now()
         WHERE id = $1`,
        [
          prodId,
          row.legal_name,
          row.trade_name,
          row.city,
          row.state,
          row.phone,
          row.email,
          row.status,
          leaderId,
          row.notes,
          row.tags,
        ]
      );
    } else {
      const ins = await prod.query(
        `INSERT INTO public.pharmacies (
          workspace_id, legal_name, trade_name, cnpj, city, state, phone, email, status,
          primary_attendant_id, secondary_attendant_id, leader_id, notes, tags, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL,$10,$11,$12,COALESCE($13,now()),now())
        RETURNING id`,
        [
          prodWs,
          row.legal_name,
          row.trade_name,
          row.cnpj,
          row.city,
          row.state,
          row.phone,
          row.email,
          row.status,
          leaderId,
          row.notes,
          row.tags,
          row.created_at,
        ]
      );
      prodId = ins.rows[0]?.id;
    }
    if (prodId) pharmacyIdMap.set(row.id, prodId);
  }

  for (const row of devDrivers.rows) {
    const primaryPharmacyId = row.primary_pharmacy_id
      ? pharmacyIdMap.get(row.primary_pharmacy_id) || null
      : null;
    const overrideLeaderId = row.override_leader_id
      ? leaderIdMap.get(row.override_leader_id) || null
      : null;
    const existingDriver = await prod.query(
      `SELECT id FROM public.drivers WHERE workspace_id = $1 AND phone = $2 LIMIT 1`,
      [prodWs, row.phone]
    );
    let prodId = existingDriver.rows[0]?.id;
    if (prodId) {
      await prod.query(
        `UPDATE public.drivers SET
          name = $2, cpf = $3, city = $4, state = $5, status = $6,
          primary_pharmacy_id = $7, inherit_from_primary = $8, override_leader_id = $9,
          doc_status = $10, notes = $11, tags = $12, updated_at = now()
         WHERE id = $1`,
        [
          prodId,
          row.name,
          row.cpf,
          row.city,
          row.state,
          row.status,
          primaryPharmacyId,
          row.inherit_from_primary,
          overrideLeaderId,
          row.doc_status,
          row.notes,
          row.tags,
        ]
      );
    } else {
      const ins = await prod.query(
        `INSERT INTO public.drivers (
          workspace_id, name, cpf, phone, city, state, status, primary_pharmacy_id,
          inherit_from_primary, override_attendant_id, override_leader_id, doc_status, notes, tags,
          created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,$11,$12,$13,COALESCE($14,now()),now())
        RETURNING id`,
        [
          prodWs,
          row.name,
          row.cpf,
          row.phone,
          row.city,
          row.state,
          row.status,
          primaryPharmacyId,
          row.inherit_from_primary,
          overrideLeaderId,
          row.doc_status,
          row.notes,
          row.tags,
          row.created_at,
        ]
      );
      prodId = ins.rows[0]?.id;
    }
    if (prodId) {
      const links = await dev.query(
        `SELECT * FROM public.driver_pharmacy_links WHERE workspace_id = $1 AND driver_id = $2`,
        [devWs, row.id]
      );
      for (const link of links.rows) {
        const pharmId = pharmacyIdMap.get(link.pharmacy_id);
        if (!pharmId) continue;
        await prod.query(
          `INSERT INTO public.driver_pharmacy_links (
            workspace_id, driver_id, pharmacy_id, is_primary, is_active, started_at, ended_at, notes, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,now()))
          ON CONFLICT (driver_id, pharmacy_id) DO UPDATE SET
            is_primary = EXCLUDED.is_primary,
            is_active = EXCLUDED.is_active`,
          [
            prodWs,
            prodId,
            pharmId,
            link.is_primary,
            link.is_active,
            link.started_at,
            link.ended_at,
            link.notes,
            link.created_at,
          ]
        );
      }
    }
  }

  const lpl = await dev.query(
    `SELECT * FROM public.leader_pharmacy_links WHERE workspace_id = $1`,
    [devWs]
  );
  for (const link of lpl.rows) {
    const lid = leaderIdMap.get(link.leader_id);
    const pid = pharmacyIdMap.get(link.pharmacy_id);
    if (!lid || !pid) continue;
    await prod.query(
      `INSERT INTO public.leader_pharmacy_links (workspace_id, leader_id, pharmacy_id, is_active, created_at)
       VALUES ($1,$2,$3,$4,COALESCE($5,now()))
       ON CONFLICT (leader_id, pharmacy_id) DO UPDATE SET is_active = EXCLUDED.is_active`,
      [prodWs, lid, pid, link.is_active, link.created_at]
    );
  }

  await prod.query('COMMIT');
  const after = {};
  for (const t of ['drivers', 'leaders', 'pharmacies']) {
    const r = await prod.query(`SELECT COUNT(*)::int c FROM public.${t} WHERE workspace_id = $1`, [prodWs]);
    after[t] = r.rows[0].c;
  }
  console.log(JSON.stringify({ ok: true, dryRun: false, migrated: plan.counts, prod_after: after }, null, 2));
} catch (e) {
  await prod.query('ROLLBACK');
  throw e;
} finally {
  await dev.end();
  await prod.end();
}
