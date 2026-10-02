import type { SupabaseClient } from '@supabase/supabase-js';

export type MembershipRoleRow = {
  role_id: string;
  is_primary: boolean;
  role_name: string;
  permissions: Record<string, unknown>;
};

export function mergeRolePermissions(roles: Array<{ permissions?: Record<string, unknown> | null }>): Record<string, unknown> {
  if (roles.some((r) => r.permissions?.all === true)) return { all: true };
  const merged: Record<string, Record<string, boolean>> = {};
  for (const role of roles) {
    const perms = (role.permissions || {}) as Record<string, unknown>;
    for (const [resource, val] of Object.entries(perms)) {
      if (resource === 'all') continue;
      if (typeof val !== 'object' || val === null || Array.isArray(val)) continue;
      merged[resource] = merged[resource] || {};
      for (const [action, enabled] of Object.entries(val as Record<string, unknown>)) {
        if (enabled === true) merged[resource]![action] = true;
      }
    }
  }
  return merged;
}

export async function listMembershipRoles(
  db: SupabaseClient,
  workspaceId: string,
  userId: string
): Promise<MembershipRoleRow[]> {
  const { data, error } = await db
    .from('workspace_membership_roles')
    .select('role_id, is_primary, roles(name, permissions)')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .order('is_primary', { ascending: false });
  if (error) {
    if ((error.message || '').includes('workspace_membership_roles')) return [];
    throw new Error(error.message);
  }
  return (data || [])
    .map((row) => {
      const role = Array.isArray(row.roles) ? row.roles[0] : row.roles;
      const name = String(role?.name || '').trim().toLowerCase();
      if (!name || !row.role_id) return null;
      return {
        role_id: String(row.role_id),
        is_primary: Boolean(row.is_primary),
        role_name: name,
        permissions: (role?.permissions as Record<string, unknown>) || {},
      } satisfies MembershipRoleRow;
    })
    .filter((r): r is MembershipRoleRow => Boolean(r));
}

export async function replaceMembershipRoles(
  db: SupabaseClient,
  workspaceId: string,
  userId: string,
  roleIds: string[],
  primaryRoleId?: string | null
): Promise<MembershipRoleRow[]> {
  const uniqueIds = Array.from(new Set(roleIds.filter(Boolean)));
  if (!uniqueIds.length) throw new Error('Selecione ao menos um papel.');

  const primary =
    primaryRoleId && uniqueIds.includes(primaryRoleId) ? primaryRoleId : uniqueIds[0]!;

  const { error: delErr } = await db
    .from('workspace_membership_roles')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId);
  if (delErr) throw new Error(delErr.message);

  const now = new Date().toISOString();
  const rows = uniqueIds.map((role_id) => ({
    workspace_id: workspaceId,
    user_id: userId,
    role_id,
    is_primary: role_id === primary,
    updated_at: now,
  }));

  const { error: insErr } = await db.from('workspace_membership_roles').insert(rows);
  if (insErr) throw new Error(insErr.message);

  // Mantém compatibilidade com workspace_memberships.role_id (papel primário)
  const { error: memErr } = await db
    .from('workspace_memberships')
    .update({ role_id: primary, updated_at: now })
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId);
  if (memErr) throw new Error(memErr.message);

  const { error: userErr } = await db
    .from('users')
    .update({ role_id: primary, updated_at: now })
    .eq('id', userId);
  if (userErr) throw new Error(userErr.message);

  return listMembershipRoles(db, workspaceId, userId);
}

export async function resolveAuthRolesForUser(
  db: SupabaseClient,
  workspaceId: string,
  userId: string,
  fallbackRoleId?: string | null
): Promise<{
  primaryRoleName: string;
  primaryRoleId: string | null;
  roleNames: string[];
  roleIds: string[];
  permissions: Record<string, unknown>;
  rows: MembershipRoleRow[];
}> {
  let rows = await listMembershipRoles(db, workspaceId, userId);

  if (!rows.length && fallbackRoleId) {
    const { data: role } = await db
      .from('roles')
      .select('id, name, permissions')
      .eq('workspace_id', workspaceId)
      .eq('id', fallbackRoleId)
      .maybeSingle();
    if (role?.id) {
      rows = [
        {
          role_id: String(role.id),
          is_primary: true,
          role_name: String(role.name || 'attendant').toLowerCase(),
          permissions: (role.permissions as Record<string, unknown>) || {},
        },
      ];
    }
  }

  if (!rows.length) {
    return {
      primaryRoleName: 'attendant',
      primaryRoleId: null,
      roleNames: ['attendant'],
      roleIds: [],
      permissions: {},
      rows: [],
    };
  }

  const primary = rows.find((r) => r.is_primary) || rows[0]!;
  const roleNames = Array.from(new Set(rows.map((r) => r.role_name)));
  const roleIds = rows.map((r) => r.role_id);

  return {
    primaryRoleName: primary.role_name,
    primaryRoleId: primary.role_id,
    roleNames,
    roleIds,
    permissions: mergeRolePermissions(rows),
    rows,
  };
}
