#!/usr/bin/env node
/**
 * Redefine senha robert@fluxfarma.com.br recriando Auth (registro migrado via SQL estava inconsistente).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { loadProductionApiEnv } from './lib/loadProdEnv.mjs';

const email = 'robert@fluxfarma.com.br';
const newPassword = process.env.NEW_PASSWORD || 'Aethera@Flux2026!';
const name = process.env.PLATFORM_OWNER_NAME || 'Robert';

loadProductionApiEnv();
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });

const pgClient = new pg.Client({
  connectionString: readFileSync('.secrets/production-db-url.txt', 'utf8').trim(),
  ssl: { rejectUnauthorized: false },
});
await pgClient.connect();

const old = await pgClient.query(`SELECT id FROM public.users WHERE lower(email) = lower($1)`, [email]);
const oldId = old.rows[0]?.id;

if (oldId) {
  await pgClient.query(`DELETE FROM public.workspace_memberships WHERE user_id = $1`, [oldId]);
  try {
    await pgClient.query(`DELETE FROM public.user_sectors WHERE user_id = $1`, [oldId]);
  } catch {
    /* opcional */
  }
  await pgClient.query(`DELETE FROM public.users WHERE id = $1`, [oldId]);
  await pgClient.query(`DELETE FROM auth.identities WHERE user_id = $1`, [oldId]);
  await pgClient.query(`DELETE FROM auth.users WHERE id = $1`, [oldId]);
}

const { data: created, error: createErr } = await sb.auth.admin.createUser({
  email,
  password: newPassword,
  email_confirm: true,
  user_metadata: { name },
});
if (createErr) throw createErr;
const authUser = created.user;
if (!authUser?.id) throw new Error('createUser sem id');

const ws = await pgClient.query(`SELECT id FROM public.workspaces WHERE slug = 'default' LIMIT 1`);
const workspaceId = ws.rows[0]?.id;
if (!workspaceId) throw new Error('Workspace default ausente');

const role = await pgClient.query(
  `SELECT id FROM public.roles WHERE workspace_id = $1 AND name = 'admin' LIMIT 1`,
  [workspaceId]
);
const roleId = role.rows[0]?.id;
if (!roleId) throw new Error("Role admin ausente");

await pgClient.query(
  `INSERT INTO public.users (id, name, email, phone, role_id, platform_role, is_active, must_change_password, provisioned_at, created_at, updated_at)
   VALUES ($1,$2,$3,$4,$5,'platform_owner',true,false,now(),now(),now())
   ON CONFLICT (id) DO UPDATE SET
     name = EXCLUDED.name,
     email = EXCLUDED.email,
     role_id = EXCLUDED.role_id,
     platform_role = 'platform_owner',
     is_active = true,
     must_change_password = false,
     updated_at = now()`,
  [authUser.id, name, email, '+5511999990001', roleId]
);

await pgClient.query(
  `INSERT INTO public.workspace_memberships (workspace_id, user_id, role_id, is_active, is_default, created_at, updated_at)
   VALUES ($1,$2,$3,true,true,now(),now())
   ON CONFLICT (workspace_id, user_id) DO UPDATE SET role_id = EXCLUDED.role_id, is_active = true, is_default = true, updated_at = now()`,
  [workspaceId, authUser.id, roleId]
);

await pgClient.end();

const { error: loginErr } = await sb.auth.signInWithPassword({ email, password: newPassword });
if (loginErr) throw new Error(`Login test: ${loginErr.message}`);

const reportsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'reports');
mkdirSync(reportsDir, { recursive: true });
const outPath = join(reportsDir, 'platform-owner-bootstrap.txt');
writeFileSync(
  outPath,
  [`email=${email}`, `password=${newPassword}`, `reset_at=${new Date().toISOString()}`, 'note=Conta Auth recriada em produção (omhlb)', ''].join('\n'),
  'utf8'
);

console.log(JSON.stringify({ ok: true, email, user_id: authUser.id, report: outPath }, null, 2));
