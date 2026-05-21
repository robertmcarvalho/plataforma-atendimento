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

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SCRIPTS !== 'true') {
    throw new Error('Script QA bloqueado em producao.');
  }

  const supabase = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const email = process.env.LEADER_QA_EMAIL || 'qa-lider-robert@fluxfarma.local';
  const password = process.env.LEADER_QA_PASSWORD || 'QaLiderRobert@2026!';
  const leaderNameMatchers = [
    process.env.LEADER_QA_MATCH_NAME,
    'ROBERT MAGDIEL DE CARVALHO',
    'Líder Teste',
  ].filter(Boolean);

  const workspaceRes = await supabase.from('workspaces').select('id, display_name').eq('slug', 'default').maybeSingle();
  if (workspaceRes.error) throw workspaceRes.error;
  const workspace =
    workspaceRes.data ||
    (await supabase.from('workspaces').select('id, display_name').order('created_at').limit(1).maybeSingle()).data;
  if (!workspace?.id) throw new Error('Nenhum workspace encontrado.');

  let leaderRow = null;
  for (const pattern of leaderNameMatchers) {
    const leaderRes = await supabase
      .from('leaders')
      .select('id, name, phone, email, workspace_id')
      .eq('workspace_id', workspace.id)
      .ilike('name', `%${pattern}%`)
      .limit(1)
      .maybeSingle();
    if (leaderRes.error) throw leaderRes.error;
    if (leaderRes.data?.id) {
      leaderRow = leaderRes.data;
      break;
    }
  }
  if (!leaderRow?.id) {
    const fallback = await supabase
      .from('leaders')
      .select('id, name, phone, email, workspace_id')
      .eq('workspace_id', workspace.id)
      .order('created_at')
      .limit(1)
      .maybeSingle();
    if (fallback.error) throw fallback.error;
    leaderRow = fallback.data;
  }
  if (!leaderRow?.id) throw new Error('Nenhum líder encontrado no workspace para vincular ao usuário QA.');

  const roleRes = await supabase
    .from('roles')
    .select('id')
    .eq('workspace_id', workspace.id)
    .eq('name', 'leader')
    .maybeSingle();
  if (roleRes.error) throw roleRes.error;
  if (!roleRes.data?.id) throw new Error("Role 'leader' não encontrada.");

  const phone = String(leaderRow.phone || '+5534999991003');
  const authUser = await ensureAuthUser(supabase, {
    name: leaderRow.name || 'Líder QA',
    email,
    password,
  });

  const { error: userErr } = await supabase.from('users').upsert(
    {
      id: authUser.id,
      name: leaderRow.name || 'Líder QA',
      email,
      phone,
      username: 'qa.lider.robert',
      role_id: roleRes.data.id,
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

  const leaderPatch = {
    user_id: authUser.id,
    email,
    phone,
    status: 'active',
    updated_at: new Date().toISOString(),
  };
  const { error: leaderErr } = await supabase
    .from('leaders')
    .update(leaderPatch)
    .eq('workspace_id', workspace.id)
    .eq('id', leaderRow.id);
  if (leaderErr) throw leaderErr;

  console.log(`LEADER_EMAIL=${email}`);
  console.log(`LEADER_PASSWORD=${password}`);
  console.log(`LEADER_ID=${leaderRow.id}`);
  console.log(`LEADER_NAME=${leaderRow.name || ''}`);
  console.log(`WORKSPACE_NAME=${workspace.display_name || 'Workspace'}`);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
