import { createClient } from '@supabase/supabase-js';
import { loadApiServiceEnv } from './lib/loadApiEnv.mjs';

loadApiServiceEnv();

function requiredEnv(key) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} ausente no ambiente`);
  return value;
}

async function ensureAuthUser(supabase, input) {
  const { data: listed, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) throw listErr;
  const existing = (listed?.users || []).find((user) => (user.email || '').toLowerCase() === input.email.toLowerCase());
  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password: input.password,
      email_confirm: true,
      user_metadata: { name: input.name },
    });
    if (error) throw error;
    return data.user;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { name: input.name },
  });
  if (error) throw error;
  return data.user;
}

async function getWorkspace(supabase) {
  const { data, error } = await supabase
    .from('workspaces')
    .select('id, slug, display_name')
    .eq('slug', 'default')
    .maybeSingle();
  if (error) throw error;
  if (data?.id) return data;

  const fallback = await supabase.from('workspaces').select('id, slug, display_name').order('created_at').limit(1).maybeSingle();
  if (fallback.error) throw fallback.error;
  if (!fallback.data?.id) throw new Error('Nenhum workspace encontrado.');
  return fallback.data;
}

async function getRole(supabase, workspaceId, roleName) {
  const scoped = await supabase
    .from('roles')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('name', roleName)
    .maybeSingle();
  if (scoped.error) throw scoped.error;
  if (scoped.data?.id) return scoped.data.id;

  const fallback = await supabase.from('roles').select('id').eq('name', roleName).maybeSingle();
  if (fallback.error) throw fallback.error;
  if (!fallback.data?.id) throw new Error(`Role '${roleName}' nao encontrada.`);
  return fallback.data.id;
}

async function getSectorId(supabase, workspaceId) {
  const preferred = await supabase
    .from('sectors')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('name', 'Atendimento Geral')
    .maybeSingle();
  if (preferred.error) throw preferred.error;
  if (preferred.data?.id) return preferred.data.id;

  const fallback = await supabase.from('sectors').select('id').eq('workspace_id', workspaceId).order('created_at').limit(1).maybeSingle();
  if (fallback.error) throw fallback.error;
  return fallback.data?.id || null;
}

async function ensureAppUser(supabase, input, authUser, workspaceId, roleId, sectorId) {
  const { error: userErr } = await supabase.from('users').upsert(
    {
      id: authUser.id,
      name: input.name,
      email: input.email,
      phone: input.phone,
      username: input.username,
      role_id: roleId,
      sector_id: sectorId,
      platform_role: 'member',
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
      workspace_id: workspaceId,
      user_id: authUser.id,
      role_id: roleId,
      is_active: true,
      is_default: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'workspace_id,user_id' }
  );
  if (membershipErr) throw membershipErr;

  if (sectorId) {
    const { error: sectorErr } = await supabase.from('user_sectors').upsert(
      {
        workspace_id: workspaceId,
        user_id: authUser.id,
        sector_id: sectorId,
        is_primary: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,sector_id' }
    );
    if (sectorErr) throw sectorErr;
  }
}

const qaUsers = [
  {
    role: 'attendant',
    name: 'Atendente QA',
    email: 'qa-atendente@fluxfarma.local',
    username: 'qa.atendente',
    phone: '+5534999991001',
    password: 'QaAtendente@2026!',
  },
  {
    role: 'supervisor',
    name: 'Supervisor QA',
    email: 'qa-supervisor@fluxfarma.local',
    username: 'qa.supervisor',
    phone: '+5534999991002',
    password: 'QaSupervisor@2026!',
  },
];

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SCRIPTS !== 'true') {
    throw new Error('Script QA bloqueado em producao.');
  }

  const supabase = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const workspace = await getWorkspace(supabase);
  const sectorId = await getSectorId(supabase, workspace.id);

  for (const input of qaUsers) {
    const roleId = await getRole(supabase, workspace.id, input.role);
    const authUser = await ensureAuthUser(supabase, input);
    await ensureAppUser(supabase, input, authUser, workspace.id, roleId, sectorId);
    console.log(`${input.role.toUpperCase()}_EMAIL=${input.email}`);
    console.log(`${input.role.toUpperCase()}_PASSWORD=${input.password}`);
  }

  console.log(`WORKSPACE_ID=${workspace.id}`);
  console.log(`WORKSPACE_NAME=${workspace.display_name || workspace.slug}`);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
