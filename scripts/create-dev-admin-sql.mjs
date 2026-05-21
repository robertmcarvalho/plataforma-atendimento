import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

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

function generatePassword() {
  const raw = crypto.randomBytes(16).toString('base64url');
  return `Dev@${raw.slice(0, 14)}!`;
}

function assertDevOnlyScript() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SCRIPTS !== 'true') {
    throw new Error('Script dev-only bloqueado em producao. Defina ALLOW_DEV_SCRIPTS=true apenas em ambiente controlado.');
  }
}

async function getInstanceId(client) {
  // Supabase hosted keeps a stable instance_id. Use an existing user if present.
  try {
    const res = await client.query('select instance_id from auth.users where instance_id is not null limit 1');
    if (res.rows?.[0]?.instance_id) return res.rows[0].instance_id;
  } catch {
    // ignore
  }

  // Fallback: auth.instances table (self-hosted / newer schema)
  try {
    const res = await client.query('select id from auth.instances limit 1');
    if (res.rows?.[0]?.id) return res.rows[0].id;
  } catch {
    // ignore
  }

  // Last resort: well-known local value used by many Supabase setups.
  return '00000000-0000-0000-0000-000000000000';
}

async function ensureRoleAndSector(client) {
  // roles.name is UNIQUE in migration 001; sectors.name is not. We pick the first match for sector by name.
  const roleRes = await client.query(`select id from public.roles where name = 'admin' limit 1`);
  if (!roleRes.rows?.[0]?.id) {
    await client.query(`insert into public.roles (name, permissions) values ('admin', '{"all": true}'::jsonb)`);
  }
  const { rows: roleRows } = await client.query(`select id from public.roles where name = 'admin' limit 1`);
  const adminRoleId = roleRows[0].id;

  const sectorRes = await client.query(`select id from public.sectors where name = 'Atendimento Geral' limit 1`);
  if (!sectorRes.rows?.[0]?.id) {
    await client.query(`insert into public.sectors (name, description, business_hours) values ('Atendimento Geral', 'Fila principal de atendimento', '{}'::jsonb)`);
  }
  const { rows: sectorRows } = await client.query(`select id from public.sectors where name = 'Atendimento Geral' limit 1`);
  const atendimentoGeralSectorId = sectorRows[0].id;

  return { adminRoleId, atendimentoGeralSectorId };
}

async function main() {
  assertDevOnlyScript();
  const connectionString = readDbUrl();

  const email = process.env.DEV_ADMIN_EMAIL || 'dev-admin@fluxfarma.local';
  const name = process.env.DEV_ADMIN_NAME || 'Administrador Desenvolvimento';
  const phone = process.env.DEV_ADMIN_PHONE || '+5534999990000';
  const password = process.env.DEV_ADMIN_PASSWORD || generatePassword();

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query('begin');

    // Ensure pgcrypto (crypt/gen_salt) exists.
    try {
      await client.query('create extension if not exists pgcrypto');
    } catch {
      // On some hosted setups this may be restricted; usually pgcrypto is already available.
    }

    const instanceId = await getInstanceId(client);
    const { adminRoleId, atendimentoGeralSectorId } = await ensureRoleAndSector(client);

    const existing = await client.query('select id from auth.users where email = $1 limit 1', [email]);
    const userId = existing.rows?.[0]?.id || crypto.randomUUID();

    if (existing.rows?.length) {
      // Update password + metadata, keep user id stable.
      await client.query(
        `
        update auth.users
        set
          encrypted_password = crypt($2, gen_salt('bf')),
          raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('name', $3),
          updated_at = now(),
          email_confirmed_at = coalesce(email_confirmed_at, now())
        where id = $1
        `,
        [userId, password, name]
      );
    } else {
      // Insert auth user + identity (needed for password login).
      await client.query(
        `
        insert into auth.users (
          id,
          instance_id,
          role,
          aud,
          email,
          raw_app_meta_data,
          raw_user_meta_data,
          is_super_admin,
          encrypted_password,
          created_at,
          updated_at,
          last_sign_in_at,
          email_confirmed_at,
          confirmation_sent_at,
          confirmation_token,
          recovery_token,
          email_change_token_new,
          email_change
        ) values (
          $1,
          $2,
          'authenticated',
          'authenticated',
          $3,
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('name', $4),
          false,
          crypt($5, gen_salt('bf')),
          now(),
          now(),
          now(),
          now(),
          now(),
          '',
          '',
          '',
          ''
        )
        `,
        [userId, instanceId, email, name, password]
      );

      await client.query(
        `
        insert into auth.identities (
          id,
          provider,
          user_id,
          identity_data,
          last_sign_in_at,
          created_at,
          updated_at
        ) values (
          $1,
          'email',
          $1,
          jsonb_build_object('sub', $1, 'email', $2, 'email_verified', true),
          now(),
          now(),
          now()
        )
        on conflict do nothing
        `,
        [userId, email]
      );
    }

    // Upsert public.users (app profile) to match auth uuid.
    await client.query(
      `
      insert into public.users (id, name, email, phone, role_id, sector_id, is_active, updated_at)
      values ($1, $2, $3, $4, $5, $6, true, now())
      on conflict (id) do update set
        name = excluded.name,
        email = excluded.email,
        phone = excluded.phone,
        role_id = excluded.role_id,
        sector_id = excluded.sector_id,
        is_active = true,
        updated_at = now()
      `,
      [userId, name, email, phone, adminRoleId, atendimentoGeralSectorId]
    );

    await client.query('commit');

    console.log(`DEV_ADMIN_EMAIL=${email}`);
    console.log(`DEV_ADMIN_PASSWORD=${password}`);
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
  const code = err?.code ? String(err.code) : '';
  const msg = (err?.message || '').trim();
  if (code === 'EACCES') {
    console.error('EACCES: conexao bloqueada (firewall/antivirus/Controlled Folder Access). Permita node.exe e tente novamente.');
  }
  console.error([code, msg].filter(Boolean).join(': ') || String(err));
  process.exit(1);
});

