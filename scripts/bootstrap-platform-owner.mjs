#!/usr/bin/env node
/**
 * Bootstrap único: platform_owner em produção (plataforma_atendimento / omhlb…).
 *
 *   $env:PLATFORM_OWNER_EMAIL="seu@email.com"
 *   $env:PLATFORM_OWNER_PASSWORD="SenhaForte@2026!"
 *   $env:PLATFORM_OWNER_NAME="Nome Admin"
 *   $env:CONFIRM_PROD_PLATFORM_BOOTSTRAP="true"
 *   npm run bootstrap:platform-owner
 */
import { createClient } from '@supabase/supabase-js';
import { assertProductionTarget, loadProductionApiEnv, projectRefFromSupabaseUrl } from './lib/loadProdEnv.mjs';

const PROD_REF = 'omhlbavfsttwcnybzvcd';

function required(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} é obrigatório`);
  return v;
}

async function main() {
  if (process.env.CONFIRM_PROD_PLATFORM_BOOTSTRAP !== 'true') {
    throw new Error('Defina CONFIRM_PROD_PLATFORM_BOOTSTRAP=true para executar.');
  }

  loadProductionApiEnv();
  const url = process.env.SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY ausentes (use .secrets/production-api.env).');
  }

  process.env.CONFIRM_PRODUCTION_TARGET = 'true';
  assertProductionTarget(url);

  const ref = projectRefFromSupabaseUrl(url);
  if (ref !== PROD_REF) {
    throw new Error(`SUPABASE_URL ref=${ref} — esperado produção ${PROD_REF}.`);
  }

  const email = required('PLATFORM_OWNER_EMAIL');
  const password = required('PLATFORM_OWNER_PASSWORD');
  const name = process.env.PLATFORM_OWNER_NAME?.trim() || 'Platform Owner';
  const phone = process.env.PLATFORM_OWNER_PHONE?.trim() || '+5511999990001';

  if (/@fluxfarma\.local$|@rhcoopmob\.dev$/i.test(email)) {
    throw new Error('Use e-mail real de produção, não domínio de teste.');
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const workspaceRes = await supabase.from('workspaces').select('id, slug').eq('slug', 'default').maybeSingle();
  if (workspaceRes.error) throw workspaceRes.error;
  const workspace =
    workspaceRes.data ||
    (await supabase.from('workspaces').select('id, slug').order('created_at').limit(1).maybeSingle()).data;
  if (!workspace?.id) throw new Error('Nenhum workspace encontrado em produção.');

  const roleRes = await supabase
    .from('roles')
    .select('id')
    .eq('workspace_id', workspace.id)
    .eq('name', 'admin')
    .maybeSingle();
  if (roleRes.error) throw roleRes.error;
  if (!roleRes.data?.id) {
    const fallback = await supabase.from('roles').select('id').eq('name', 'admin').maybeSingle();
    if (fallback.error || !fallback.data?.id) throw new Error("Role 'admin' não encontrada.");
    roleRes.data = fallback.data;
  }

  const { data: listed, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) throw listErr;
  const existing = (listed?.users || []).find((u) => (u.email || '').toLowerCase() === email.toLowerCase());

  let authUser;
  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (error) throw error;
    authUser = data.user;
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (error) throw error;
    authUser = data.user;
  }
  if (!authUser?.id) throw new Error('Falha ao obter auth user id');

  const { error: userErr } = await supabase.from('users').upsert(
    {
      id: authUser.id,
      name,
      email,
      phone,
      role_id: roleRes.data.id,
      platform_role: 'platform_owner',
      is_active: true,
      must_change_password: false,
      provisioned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );
  if (userErr) throw userErr;

  const { error: membershipErr } = await supabase.from('workspace_memberships').upsert(
    {
      workspace_id: workspace.id,
      user_id: authUser.id,
      role_id: roleRes.data.id,
      is_active: true,
      is_default: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id,user_id' }
  );
  if (membershipErr) throw membershipErr;

  console.log(
    JSON.stringify(
      {
        ok: true,
        ref: PROD_REF,
        email,
        user_id: authUser.id,
        workspace_id: workspace.id,
        platform_role: 'platform_owner',
        next: 'Login em https://aetheraai.online e configure workspaces/usuários pela UI.',
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
