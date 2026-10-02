import crypto from 'crypto';
import { supabase } from './supabase';
import { findAuthUserIdByEmail, setAuthUserPassword } from './authUserAdmin';

export function isDuplicateAuthEmailError(message: string | undefined): boolean {
  const m = (message || '').toLowerCase();
  return (
    m.includes('already been registered') ||
    m.includes('already registered') ||
    m.includes('user already exists') ||
    m.includes('email address has already been registered')
  );
}

/** Mensagem em PT para erros do Supabase Auth no fluxo de provisionamento. */
export function humanizeProvisionAuthError(message: string): string {
  if (isDuplicateAuthEmailError(message)) {
    return 'Já existe uma conta de acesso com este e-mail.';
  }
  return message;
}

export type LeaderProvisionLinkResult =
  | { ok: true; userId: string; username: string; userRow: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Quando o e-mail já existe no Auth, vincula o perfil de líder pré-cadastrado ao usuário existente
 * (reset de senha + membership) em vez de falhar com 400 opaco.
 */
export async function tryLinkLeaderProvisionToExistingUser(params: {
  workspaceId: string;
  leaderId: string;
  email: string;
  name: string;
  roleId: string;
  phone?: string | null;
  temporaryPassword: string;
}): Promise<LeaderProvisionLinkResult> {
  const email = params.email.trim();
  let existingUser: { id: string; name?: string | null; email?: string | null; username?: string | null } | null = null;
  let repairFromAuth = false;

  const { data: userByEmail, error: userErr } = await supabase
    .from('users')
    .select('id, name, email, username')
    .ilike('email', email)
    .maybeSingle();
  if (userErr) return { ok: false, error: userErr.message };

  if (userByEmail) {
    existingUser = userByEmail;
  } else {
    let authUserId: string | null;
    try {
      authUserId = await findAuthUserIdByEmail(email);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Falha ao localizar conta no login.' };
    }
    if (!authUserId) {
      return {
        ok: false,
        error:
          'E-mail já cadastrado no login, mas não foi possível localizar a conta. Contate o suporte.',
      };
    }

    const { data: userById, error: userByIdErr } = await supabase
      .from('users')
      .select('id, name, email, username')
      .eq('id', authUserId)
      .maybeSingle();
    if (userByIdErr) return { ok: false, error: userByIdErr.message };

    if (userById) {
      existingUser = userById;
    } else {
      existingUser = { id: authUserId, email, name: params.name, username: null };
      repairFromAuth = true;
    }
  }

  const { data: leader, error: leaderErr } = await supabase
    .from('leaders')
    .select('id, user_id')
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.leaderId)
    .maybeSingle();
  if (leaderErr) return { ok: false, error: leaderErr.message };
  if (!leader) return { ok: false, error: 'Líder não encontrado neste workspace.' };
  if (leader.user_id) return { ok: false, error: 'Este líder já possui usuário vinculado.' };

  const { data: otherLeader } = await supabase
    .from('leaders')
    .select('id')
    .eq('workspace_id', params.workspaceId)
    .eq('user_id', existingUser.id)
    .neq('id', params.leaderId)
    .maybeSingle();
  if (otherLeader) {
    return { ok: false, error: 'Este e-mail já está vinculado a outro líder.' };
  }

  const { data: membership } = await supabase
    .from('workspace_memberships')
    .select('is_active, roles(name)')
    .eq('workspace_id', params.workspaceId)
    .eq('user_id', existingUser.id)
    .maybeSingle();
  const roleRel = membership?.roles;
  let roleName: string | null = null;
  if (Array.isArray(roleRel)) {
    roleName = String(roleRel[0]?.name || '').trim() || null;
  } else if (roleRel && typeof roleRel === 'object' && 'name' in roleRel) {
    roleName = String((roleRel as { name?: string }).name || '').trim() || null;
  }
  if (membership?.is_active && roleName && roleName !== 'leader') {
    return {
      ok: false,
      error: `Já existe usuário ativo com perfil "${roleName}". Altere o perfil na ficha do usuário ou use outro e-mail.`,
    };
  }

  const username =
    existingUser.username || (await generateUsername(params.workspaceId, params.name, email));

  try {
    await setAuthUserPassword(existingUser.id, params.temporaryPassword);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Falha ao atualizar senha no login.' };
  }

  const now = new Date().toISOString();
  const profilePayload = {
    name: params.name,
    email,
    username,
    role_id: params.roleId,
    must_change_password: true,
    provisioned_at: now,
    updated_at: now,
    ...(params.phone ? { phone: params.phone } : {}),
  };

  let userRow: Record<string, unknown>;
  if (repairFromAuth) {
    const { data: inserted, error: insertErr } = await supabase
      .from('users')
      .insert({ id: existingUser.id, ...profilePayload })
      .select('*, roles(name), sectors(name), user_sectors(sector_id, is_primary)')
      .single();
    if (insertErr) return { ok: false, error: insertErr.message };
    userRow = inserted as Record<string, unknown>;
  } else {
    const { data: updated, error: updateErr } = await supabase
      .from('users')
      .update(profilePayload)
      .eq('id', existingUser.id)
      .select('*, roles(name), sectors(name), user_sectors(sector_id, is_primary)')
      .single();
    if (updateErr) return { ok: false, error: updateErr.message };
    userRow = updated as Record<string, unknown>;
  }

  return { ok: true, userId: existingUser.id, username, userRow };
}

export function generateTemporaryPassword(length = 16): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) out += chars[bytes[i]! % chars.length];
  return out;
}

export async function generateUsername(workspaceId: string, name: string, email: string): Promise<string> {
  const { data: workspace } = await supabase.from('workspaces').select('slug').eq('id', workspaceId).maybeSingle();
  const slug = String(workspace?.slug || 'workspace')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 20);
  const base = name
    .trim()
    .split(/\s+/)[0]
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, '') || email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
  let candidate = `${base}.${slug}`.slice(0, 48);
  for (let i = 0; i < 20; i++) {
    const { data } = await supabase.from('users').select('id').eq('username', candidate).maybeSingle();
    if (!data) return candidate;
    candidate = `${base}.${slug}${i + 2}`.slice(0, 48);
  }
  return `${base}.${slug}.${Date.now().toString(36)}`.slice(0, 48);
}
