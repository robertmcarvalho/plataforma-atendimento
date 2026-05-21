#!/usr/bin/env node
/**
 * Migra dados do Supabase legado (ojzzx, ex-produção Cloud Run) → plataforma_atendimento (omhlb).
 * Preserva senhas (hash em auth.users), canais/webhook, app_settings, cadastros e usuários.
 *
 * Pré-requisitos:
 *   1. node scripts/prepare-legacy-ojzzx-secrets.mjs
 *   2. Reativar projeto ojzzx no Dashboard (pode pausar outro projeto free temporariamente)
 *   3. Salvar pooler em .secrets/legacy-db-url.txt
 *
 *   npm run migrate:legacy-ojzzx-to-prod
 *   $env:CONFIRM_MIGRATE_LEGACY_OJZZX_TO_PROD="true"
 *   npm run migrate:legacy-ojzzx-to-prod -- --execute
 *
 * Fases (--phases=auth,settings,channels,cadastros,flows,users,all)
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEGACY_REF,
  PROD_REF,
  assertRef,
  connectPg,
  snapshot,
  resolveWorkspaceMap,
} from './lib/migrateLegacyDb.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const secretsDir = path.join(repoRoot, '.secrets');
const execute = process.argv.includes('--execute');
const phasesArg = process.argv.find((a) => a.startsWith('--phases='));
const phases = new Set(
  (phasesArg ? phasesArg.split('=')[1] : 'all').split(',').map((p) => p.trim())
);
if (phases.has('all')) {
  ['auth', 'settings', 'channels', 'cadastros', 'flows', 'users'].forEach((p) => phases.add(p));
}

if (execute && process.env.CONFIRM_MIGRATE_LEGACY_OJZZX_TO_PROD !== 'true') {
  throw new Error('Defina CONFIRM_MIGRATE_LEGACY_OJZZX_TO_PROD=true para executar.');
}

const legacyDbPath = path.join(secretsDir, 'legacy-db-url.txt');
const prodDbPath = path.join(secretsDir, 'production-db-url.txt');
const legacyApiPath = path.join(secretsDir, 'legacy-api.env');

if (!existsSync(legacyDbPath)) {
  throw new Error(
    'Crie .secrets/legacy-db-url.txt com a connection string do pooler do projeto ojzzx (após reativar no Supabase).'
  );
}
if (!existsSync(prodDbPath)) throw new Error('Ausente .secrets/production-db-url.txt');
if (!existsSync(legacyApiPath)) {
  throw new Error('Execute antes: node scripts/prepare-legacy-ojzzx-secrets.mjs');
}

const legacyUrl = readFileSync(legacyDbPath, 'utf8').trim();
const prodUrl = readFileSync(prodDbPath, 'utf8').trim();
assertRef(legacyUrl, LEGACY_REF, 'legacy-db-url.txt');
assertRef(prodUrl, PROD_REF, 'production-db-url.txt');

const SNAPSHOT_TABLES = [
  'users',
  'pharmacies',
  'drivers',
  'leaders',
  'workspace_channels',
  'app_settings',
  'platform_settings',
  'conversation_flow_definitions',
  'conversations',
];

async function migrateAuthUsers(src, dst) {
  const instRow = await dst.query(`SELECT instance_id FROM auth.users WHERE instance_id IS NOT NULL LIMIT 1`);
  const instanceId = instRow.rows[0]?.instance_id || '00000000-0000-0000-0000-000000000000';

  const { rows: users } = await src.query(`
    SELECT id, aud, role, email, encrypted_password, email_confirmed_at,
           raw_app_meta_data, raw_user_meta_data, created_at, updated_at, phone, last_sign_in_at
    FROM auth.users
    WHERE deleted_at IS NULL AND email IS NOT NULL
  `);

  let ok = 0;
  let replaced = 0;
  for (const u of users) {
    if (!u.encrypted_password) continue;
    await dst.query('BEGIN');
    try {
      const dup = await dst.query(
        `SELECT id FROM auth.users WHERE lower(email) = lower($1) AND id <> $2 LIMIT 1`,
        [u.email, u.id]
      );
      const dupId = dup.rows[0]?.id;
      if (dupId) {
        await dst.query(`DELETE FROM public.workspace_memberships WHERE user_id = $1`, [dupId]);
        try {
          await dst.query(`DELETE FROM public.user_sectors WHERE user_id = $1`, [dupId]);
        } catch {
          /* tabela opcional */
        }
        await dst.query(`DELETE FROM public.users WHERE id = $1`, [dupId]);
        await dst.query(`DELETE FROM auth.identities WHERE user_id = $1`, [dupId]);
        await dst.query(`DELETE FROM auth.users WHERE id = $1`, [dupId]);
        replaced++;
      }

      await dst.query(`DELETE FROM auth.identities WHERE user_id = $1`, [u.id]);
      await dst.query(`DELETE FROM auth.users WHERE id = $1`, [u.id]);
      await dst.query(
        `INSERT INTO auth.users (
          instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at, phone, last_sign_in_at
        ) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7, now()),$8,$9,$10,$11,$12,$13)`,
        [
          instanceId,
          u.id,
          u.aud || 'authenticated',
          u.role || 'authenticated',
          u.email,
          u.encrypted_password,
          u.email_confirmed_at,
          u.raw_app_meta_data || {},
          u.raw_user_meta_data || {},
          u.created_at,
          u.updated_at,
          u.phone,
          u.last_sign_in_at,
        ]
      );
      const { rows: identities } = await src.query(`SELECT * FROM auth.identities WHERE user_id = $1`, [u.id]);
      for (const ident of identities) {
        await dst.query(
          `INSERT INTO auth.identities (
            id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (id) DO UPDATE SET
            identity_data = EXCLUDED.identity_data,
            provider_id = EXCLUDED.provider_id`,
          [
            ident.id,
            ident.user_id,
            ident.provider_id,
            ident.identity_data,
            ident.provider,
            ident.last_sign_in_at,
            ident.created_at,
            ident.updated_at,
          ]
        );
      }
      await dst.query('COMMIT');
      ok++;
    } catch (e) {
      await dst.query('ROLLBACK');
      throw new Error(`auth ${u.email}: ${e.message}`);
    }
  }
  return { auth_users: users.length, migrated: ok, replaced_duplicate_emails: replaced };
}

function jsonbLiteral(value) {
  if (value === null || value === undefined) return '{}';
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch {
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(value);
}

async function migrateSettings(src, dst, workspaceMap) {
  const defaultProdWs = [...workspaceMap.values()][0];
  const platform = (await src.query(`SELECT * FROM public.platform_settings`)).rows;
  let platformN = 0;
  for (const row of platform) {
    await dst.query(
      `INSERT INTO public.platform_settings (key, value, updated_at)
       VALUES ($1, $2::jsonb, COALESCE($3, now()))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [row.key, jsonbLiteral(row.value), row.updated_at]
    );
    platformN++;
  }

  const settings = (await src.query(`SELECT * FROM public.app_settings`)).rows;
  let appN = 0;
  for (const row of settings) {
    const workspace_id = row.workspace_id
      ? workspaceMap.get(row.workspace_id) || null
      : defaultProdWs;
    if (!workspace_id) continue;
    await dst.query(
      `INSERT INTO public.app_settings (workspace_id, key, value, updated_at)
       VALUES ($1, $2, $3::jsonb, COALESCE($4, now()))
       ON CONFLICT (workspace_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [workspace_id, row.key, jsonbLiteral(row.value), row.updated_at]
    );
    appN++;
  }
  return { platform_settings: platformN, app_settings: appN };
}

async function migrateChannels(src, dst, workspaceMap) {
  const { rows } = await src.query(`SELECT * FROM public.workspace_channels ORDER BY is_default DESC, created_at`);
  let n = 0;
  for (const row of rows) {
    const workspace_id = workspaceMap.get(row.workspace_id);
    if (!workspace_id) continue;
    if (row.is_default) {
      await dst.query(
        `UPDATE public.workspace_channels SET is_default = false
         WHERE workspace_id = $1 AND channel_type = $2`,
        [workspace_id, row.channel_type]
      );
    }
    const cols = Object.keys(row).filter((c) => c !== 'workspace_id');
    const payload = { workspace_id };
    for (const c of cols) payload[c] = row[c];
    const keys = Object.keys(payload);
    const vals = Object.values(payload);
    const ph = keys.map((_, i) => `$${i + 1}`).join(',');
    const upd = keys.filter((k) => k !== 'id').map((k) => `${k} = EXCLUDED.${k}`).join(', ');
    await dst.query(
      `INSERT INTO public.workspace_channels (${keys.join(', ')})
       VALUES (${ph})
       ON CONFLICT (id) DO UPDATE SET ${upd}`,
      vals
    );
    n++;
  }
  return { workspace_channels: n };
}

async function migrateRolesAndSectors(src, dst, workspaceMap) {
  const roleIdMap = new Map();
  const { rows: roles } = await src.query(`SELECT * FROM public.roles`);
  for (const row of roles) {
    const workspace_id = row.workspace_id ? workspaceMap.get(row.workspace_id) : null;
    if (row.workspace_id && !workspace_id) continue;
    const ins = await dst.query(
      `INSERT INTO public.roles (workspace_id, name, permissions, created_at)
       VALUES ($1,$2,$3,COALESCE($4,now()))
       ON CONFLICT (workspace_id, name) DO UPDATE SET permissions = EXCLUDED.permissions
       RETURNING id`,
      [workspace_id, row.name, row.permissions, row.created_at]
    );
    const prodId = ins.rows[0]?.id;
    if (!prodId && workspace_id) {
      const ex = await dst.query(`SELECT id FROM public.roles WHERE workspace_id = $1 AND name = $2`, [
        workspace_id,
        row.name,
      ]);
      if (ex.rows[0]?.id) roleIdMap.set(row.id, ex.rows[0].id);
    } else if (prodId) {
      roleIdMap.set(row.id, prodId);
    }
  }

  const sectorIdMap = new Map();
  try {
    const { rows: sectors } = await src.query(`SELECT * FROM public.sectors`);
    for (const row of sectors) {
      const workspace_id = row.workspace_id ? workspaceMap.get(row.workspace_id) : null;
      if (row.workspace_id && !workspace_id) continue;
      const ins = await dst.query(
        `INSERT INTO public.sectors (workspace_id, name, description, is_active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,COALESCE($5,now()),now())
         ON CONFLICT (workspace_id, name) DO UPDATE SET description = EXCLUDED.description, is_active = EXCLUDED.is_active, updated_at = now()
         RETURNING id`,
        [workspace_id, row.name, row.description, row.is_active, row.created_at]
      );
      const prodId = ins.rows[0]?.id;
      if (!prodId && workspace_id) {
        const ex = await dst.query(`SELECT id FROM public.sectors WHERE workspace_id = $1 AND name = $2`, [
          workspace_id,
          row.name,
        ]);
        if (ex.rows[0]?.id) sectorIdMap.set(row.id, ex.rows[0].id);
      } else if (prodId) {
        sectorIdMap.set(row.id, prodId);
      }
    }
  } catch {
    /* sectors opcional */
  }

  return { roleIdMap, sectorIdMap };
}

async function migratePublicUsers(src, dst, workspaceMap, roleIdMap, sectorIdMap) {
  const { rows } = await src.query(`SELECT * FROM public.users`);
  let n = 0;
  for (const row of rows) {
    const role_id = row.role_id ? roleIdMap.get(row.role_id) || row.role_id : null;
    const sector_id = row.sector_id ? sectorIdMap.get(row.sector_id) || row.sector_id : null;
    await dst.query(
      `INSERT INTO public.users (
        id, name, email, phone, role_id, sector_id, platform_role, is_active,
        must_change_password, provisioned_at, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,now()),COALESCE($12,now()))
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        phone = EXCLUDED.phone,
        role_id = EXCLUDED.role_id,
        sector_id = EXCLUDED.sector_id,
        platform_role = EXCLUDED.platform_role,
        is_active = EXCLUDED.is_active,
        must_change_password = EXCLUDED.must_change_password,
        updated_at = now()`,
      [
        row.id,
        row.name,
        row.email,
        row.phone,
        role_id,
        sector_id,
        row.platform_role,
        row.is_active,
        row.must_change_password,
        row.provisioned_at,
        row.created_at,
        row.updated_at,
      ]
    );
    n++;
  }

  const memberships = (await src.query(`SELECT * FROM public.workspace_memberships`)).rows;
  let m = 0;
  for (const row of memberships) {
    const workspace_id = workspaceMap.get(row.workspace_id);
    if (!workspace_id) continue;
    const membershipRoleId = row.role_id ? roleIdMap.get(row.role_id) || row.role_id : row.role_id;
    await dst.query(
      `INSERT INTO public.workspace_memberships (
        workspace_id, user_id, role_id, is_active, is_default, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,COALESCE($6,now()),now())
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET
        role_id = EXCLUDED.role_id,
        is_active = EXCLUDED.is_active,
        is_default = EXCLUDED.is_default,
        updated_at = now()`,
      [workspace_id, row.user_id, membershipRoleId, row.is_active, row.is_default, row.created_at]
    );
    m++;
  }

  try {
    const userSectors = (await src.query(`SELECT * FROM public.user_sectors`)).rows;
    for (const row of userSectors) {
      await dst.query(
        `INSERT INTO public.user_sectors (user_id, sector_id, created_at)
         VALUES ($1,$2,COALESCE($3,now()))
         ON CONFLICT (user_id, sector_id) DO NOTHING`,
        [row.user_id, row.sector_id, row.created_at]
      );
    }
  } catch {
    /* tabela opcional */
  }

  return { users: n, workspace_memberships: m };
}

async function migrateFlows(src, dst, workspaceMap) {
  const defs = (await src.query(`SELECT * FROM public.conversation_flow_definitions`)).rows;
  let d = 0;
  for (const row of defs) {
    const workspace_id = workspaceMap.get(row.workspace_id);
    if (!workspace_id) continue;
    await dst.query(
      `INSERT INTO public.conversation_flow_definitions (
        id, workspace_id, slug, name, description, is_active, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,now()),COALESCE($8,now()))
      ON CONFLICT (workspace_id, slug) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        is_active = EXCLUDED.is_active,
        updated_at = now()`,
      [
        row.id,
        workspace_id,
        row.slug,
        row.name,
        row.description,
        row.is_active,
        row.created_at,
        row.updated_at,
      ]
    );
    d++;
  }

  try {
    const bindings = (await src.query(`SELECT * FROM public.conversation_flow_bindings`)).rows;
    for (const row of bindings) {
      const workspace_id = workspaceMap.get(row.workspace_id);
      if (!workspace_id) continue;
      await dst.query(
        `INSERT INTO public.conversation_flow_bindings (
          id, workspace_id, channel_type, flow_definition_id, priority, is_active, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,now()),COALESCE($8,now()))
        ON CONFLICT (id) DO UPDATE SET
          flow_definition_id = EXCLUDED.flow_definition_id,
          priority = EXCLUDED.priority,
          is_active = EXCLUDED.is_active,
          updated_at = now()`,
        [
          row.id,
          workspace_id,
          row.channel_type,
          row.flow_definition_id,
          row.priority,
          row.is_active,
          row.created_at,
          row.updated_at,
        ]
      );
    }
  } catch {
    /* opcional */
  }

  return { conversation_flow_definitions: d };
}

/** Cadastros: mesma lógica do migrate-cadastros-dev-to-prod, origem = legado. */
async function migrateCadastros(src, dst, workspaceMap) {
  const srcDefault =
    (await src.query(`SELECT id FROM public.workspaces WHERE slug = 'default' LIMIT 1`)).rows[0]?.id ||
    [...workspaceMap.keys()][0];
  const prodWs = workspaceMap.get(srcDefault);
  if (!prodWs) throw new Error('workspaceMap vazio');

  const DRIVER_FILTER = `
    NOT (COALESCE(tags, '{}') @> ARRAY['smoke-staging']::text[])
    AND name NOT ILIKE 'smoke%'
  `;
  const LEADER_FILTER = `name NOT ILIKE 'smoke%'`;
  const PHARMACY_FILTER = `trade_name NOT ILIKE 'smoke%' AND cnpj IS NOT NULL AND trim(cnpj) <> ''`;

  const devLeaders = await src.query(
    `SELECT * FROM public.leaders WHERE workspace_id = $1 AND ${LEADER_FILTER}`,
    [srcDefault]
  );
  const devPharmacies = await src.query(
    `SELECT * FROM public.pharmacies WHERE workspace_id = $1 AND ${PHARMACY_FILTER}`,
    [srcDefault]
  );
  const devDrivers = await src.query(
    `SELECT * FROM public.drivers WHERE workspace_id = $1 AND ${DRIVER_FILTER}`,
    [srcDefault]
  );

  const leaderIdMap = new Map();
  const pharmacyIdMap = new Map();

  for (const row of devLeaders.rows) {
    const ins = await dst.query(
      `INSERT INTO public.leaders (workspace_id, name, phone, email, city, state, status, notes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,now()),now())
       ON CONFLICT (workspace_id, phone) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, status = EXCLUDED.status, updated_at = now()
       RETURNING id`,
      [prodWs, row.name, row.phone, row.email, row.city, row.state, row.status, row.notes, row.created_at]
    );
    const prodId = ins.rows[0]?.id;
    if (prodId) leaderIdMap.set(row.id, prodId);
  }

  for (const row of devPharmacies.rows) {
    const leaderId = row.leader_id ? leaderIdMap.get(row.leader_id) || null : null;
    const existing = row.cnpj
      ? await dst.query(`SELECT id FROM public.pharmacies WHERE workspace_id = $1 AND cnpj = $2`, [prodWs, row.cnpj])
      : { rows: [] };
    let prodId = existing.rows[0]?.id;
    const primaryAttendantId = row.primary_attendant_id
      ? (await dst.query(`SELECT u2.id FROM public.users u2 JOIN public.users u1 ON lower(u1.email)=lower(u2.email) WHERE u1.id=$1 LIMIT 1`, [row.primary_attendant_id])).rows[0]?.id || null
      : null;
    const secondaryAttendantId = row.secondary_attendant_id
      ? (await dst.query(`SELECT u2.id FROM public.users u2 JOIN public.users u1 ON lower(u1.email)=lower(u2.email) WHERE u1.id=$1 LIMIT 1`, [row.secondary_attendant_id])).rows[0]?.id || null
      : null;
    const pharmacyCols = `legal_name=$2, trade_name=$3, city=$4, state=$5, phone=$6, email=$7, status=$8, leader_id=$9, notes=$10, tags=$11,
      address_cep=$12, address_street=$13, address_number=$14, address_neighborhood=$15, address_complement=$16,
      contact_expedition_name=$17, contact_expedition_phone=$18, contact_expedition_email=$19,
      contact_financial_name=$20, contact_financial_phone=$21, contact_financial_email=$22,
      contact_manager_name=$23, contact_manager_phone=$24, contact_manager_email=$25,
      delivery_fee_cents=$26, delivery_fee_driver_payout_cents=$27, minimum_guaranteed_cents=$28, minimum_guaranteed_driver_payout_cents=$29,
      delivery_schedule=$30, primary_attendant_id=$31, secondary_attendant_id=$32, updated_at=now()`;
    const pharmacyVals = [
      row.legal_name, row.trade_name, row.city, row.state, row.phone, row.email, row.status, leaderId, row.notes, row.tags,
      row.address_cep, row.address_street, row.address_number, row.address_neighborhood, row.address_complement,
      row.contact_expedition_name, row.contact_expedition_phone, row.contact_expedition_email,
      row.contact_financial_name, row.contact_financial_phone, row.contact_financial_email,
      row.contact_manager_name, row.contact_manager_phone, row.contact_manager_email,
      row.delivery_fee_cents, row.delivery_fee_driver_payout_cents, row.minimum_guaranteed_cents, row.minimum_guaranteed_driver_payout_cents,
      row.delivery_schedule || {}, primaryAttendantId, secondaryAttendantId,
    ];
    if (prodId) {
      await dst.query(`UPDATE public.pharmacies SET ${pharmacyCols} WHERE id=$1`, [prodId, ...pharmacyVals]);
    } else {
      const ins = await dst.query(
        `INSERT INTO public.pharmacies (
          workspace_id, legal_name, trade_name, cnpj, city, state, phone, email, status, leader_id, notes, tags,
          address_cep, address_street, address_number, address_neighborhood, address_complement,
          contact_expedition_name, contact_expedition_phone, contact_expedition_email,
          contact_financial_name, contact_financial_phone, contact_financial_email,
          contact_manager_name, contact_manager_phone, contact_manager_email,
          delivery_fee_cents, delivery_fee_driver_payout_cents, minimum_guaranteed_cents, minimum_guaranteed_driver_payout_cents,
          delivery_schedule, primary_attendant_id, secondary_attendant_id, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,COALESCE($34,now()),now())
        RETURNING id`,
        [prodWs, pharmacyVals[0], pharmacyVals[1], row.cnpj, ...pharmacyVals.slice(2), row.created_at]
      );
      prodId = ins.rows[0]?.id;
    }
    if (prodId) pharmacyIdMap.set(row.id, prodId);
  }

  for (const row of devDrivers.rows) {
    const primaryPharmacyId = row.primary_pharmacy_id ? pharmacyIdMap.get(row.primary_pharmacy_id) || null : null;
    const overrideLeaderId = row.override_leader_id ? leaderIdMap.get(row.override_leader_id) || null : null;
    const existingDriver = await dst.query(`SELECT id FROM public.drivers WHERE workspace_id = $1 AND phone = $2`, [prodWs, row.phone]);
    let prodId = existingDriver.rows[0]?.id;
    if (prodId) {
      await dst.query(
        `UPDATE public.drivers SET name=$2, cpf=$3, city=$4, state=$5, status=$6, primary_pharmacy_id=$7,
         inherit_from_primary=$8, override_leader_id=$9, doc_status=$10, notes=$11, tags=$12, updated_at=now() WHERE id=$1`,
        [prodId, row.name, row.cpf, row.city, row.state, row.status, primaryPharmacyId, row.inherit_from_primary, overrideLeaderId, row.doc_status, row.notes, row.tags]
      );
    } else {
      const ins = await dst.query(
        `INSERT INTO public.drivers (workspace_id, name, cpf, phone, city, state, status, primary_pharmacy_id, inherit_from_primary, override_leader_id, doc_status, notes, tags, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14,now()),now()) RETURNING id`,
        [prodWs, row.name, row.cpf, row.phone, row.city, row.state, row.status, primaryPharmacyId, row.inherit_from_primary, overrideLeaderId, row.doc_status, row.notes, row.tags, row.created_at]
      );
      prodId = ins.rows[0]?.id;
    }
    if (prodId) {
      const links = await src.query(`SELECT * FROM public.driver_pharmacy_links WHERE driver_id = $1`, [row.id]);
      for (const link of links.rows) {
        const pharmId = pharmacyIdMap.get(link.pharmacy_id);
        if (!pharmId) continue;
        await dst.query(
          `INSERT INTO public.driver_pharmacy_links (workspace_id, driver_id, pharmacy_id, is_primary, is_active, started_at, ended_at, notes, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,now()))
           ON CONFLICT (driver_id, pharmacy_id) DO UPDATE SET is_primary = EXCLUDED.is_primary, is_active = EXCLUDED.is_active`,
          [prodWs, prodId, pharmId, link.is_primary, link.is_active, link.started_at, link.ended_at, link.notes, link.created_at]
        );
      }
    }
  }

  return {
    leaders: devLeaders.rows.length,
    pharmacies: devPharmacies.rows.length,
    drivers: devDrivers.rows.length,
  };
}

const src = await connectPg(legacyUrl, 'Legado ojzzx');
const dst = await connectPg(prodUrl, 'Produção omhlb');

const plan = {
  execute,
  phases: [...phases],
  legacy_before: await snapshot(src, SNAPSHOT_TABLES),
  prod_before: await snapshot(dst, SNAPSHOT_TABLES),
  workspace_map: null,
  results: {},
};

const workspaceMap = await resolveWorkspaceMap(src, dst);
plan.workspace_map = Object.fromEntries(workspaceMap);

if (!execute) {
  const { rows: authEmails } = await src.query(
    `SELECT email FROM auth.users WHERE deleted_at IS NULL AND email IS NOT NULL ORDER BY email`
  );
  plan.legacy_auth_emails = authEmails.map((r) => r.email);
  console.log(JSON.stringify({ ok: true, dryRun: true, plan }, null, 2));
  console.log('\nExecute: CONFIRM_MIGRATE_LEGACY_OJZZX_TO_PROD=true npm run migrate:legacy-ojzzx-to-prod -- --execute');
  await src.end();
  await dst.end();
  process.exit(0);
}

try {
  await dst.query('BEGIN');
  if (phases.has('auth')) plan.results.auth = await migrateAuthUsers(src, dst);
  const { roleIdMap, sectorIdMap } = await migrateRolesAndSectors(src, dst, workspaceMap);
  plan.results.roles_sectors = { roles: roleIdMap.size, sectors: sectorIdMap.size };
  if (phases.has('users')) plan.results.users = await migratePublicUsers(src, dst, workspaceMap, roleIdMap, sectorIdMap);
  if (phases.has('settings')) plan.results.settings = await migrateSettings(src, dst, workspaceMap);
  if (phases.has('channels')) plan.results.channels = await migrateChannels(src, dst, workspaceMap);
  if (phases.has('flows')) plan.results.flows = await migrateFlows(src, dst, workspaceMap);
  if (phases.has('cadastros')) plan.results.cadastros = await migrateCadastros(src, dst, workspaceMap);
  await dst.query('COMMIT');
} catch (e) {
  await dst.query('ROLLBACK');
  throw e;
} finally {
  await src.end();
  await dst.end();
}

const dstAfter = await connectPg(prodUrl, 'Produção omhlb (pós)');
plan.prod_after = await snapshot(dstAfter, SNAPSHOT_TABLES);
await dstAfter.end();

mkdirSync(path.join(repoRoot, 'reports'), { recursive: true });
writeFileSync(
  path.join(repoRoot, 'reports', `migrate-legacy-ojzzx-${Date.now()}.json`),
  JSON.stringify(plan, null, 2),
  'utf8'
);
console.log(JSON.stringify({ ok: true, plan }, null, 2));
