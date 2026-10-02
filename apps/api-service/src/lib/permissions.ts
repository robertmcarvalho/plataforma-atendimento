import type { FastifyReply, FastifyRequest } from 'fastify';
import { supabase } from './supabase';
import { getWorkspaceMembership, hasPlatformAccess, requireWorkspace, type JwtUser } from './workspaceContext';
import { isOperationalAnalyst } from './operationalAnalyst';
import { expandAttendantRoles } from './roleAliases';

function normalizeRole(user: Pick<JwtUser, 'role' | 'workspace_role'>): string {
  return String(user.role || user.workspace_role || '').trim().toLowerCase();
}

export function hasResourcePermission(
  user: Pick<JwtUser, 'role' | 'workspace_role' | 'platform_role' | 'permissions'>,
  resource: string,
  action: string
): boolean {
  if (hasPlatformAccess(user as JwtUser)) return true;
  const role = String(user.role || user.workspace_role || '').trim();
  if (role === 'admin') return true;
  const perms = user.permissions;
  if (!perms || typeof perms !== 'object') return false;
  if (perms.all === true) return true;
  const group = perms[resource];
  return typeof group === 'object' && group !== null && (group as Record<string, boolean>)[action] === true;
}

export async function effectivePermissions(user: JwtUser): Promise<Record<string, unknown>> {
  const workspaceId = String(user.workspace_id || user.active_workspace_id || '').trim();
  if (workspaceId && user.sub) {
    try {
      const membership = await getWorkspaceMembership(workspaceId, user.sub);
      if (membership?.permissions) return membership.permissions;
    } catch {
      /* fallback to JWT */
    }
  }
  return user.permissions || {};
}

/** Papel legado ou toggle `permissions[resource][action]` no perfil. */
export function requireRoleOrPermission(roles: string[], resource: string, action: string) {
  const legacyRoles = new Set(expandAttendantRoles(roles.map((r) => r.toLowerCase())));
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as JwtUser;
    const role = normalizeRole(user);
    if (role === 'admin' || hasPlatformAccess(user)) return;
    if (legacyRoles.has(role)) return;
    const perms = await effectivePermissions(user);
    if (hasResourcePermission({ ...user, permissions: perms }, resource, action)) return;
    return reply.status(403).send({ error: 'Acesso negado' });
  };
}

/** Cadastro: papéis com menu de cadastro, analista operacional ou permissão `manage` do perfil. */
export function requireCadastroManage(resource: 'pharmacies' | 'drivers' | 'leaders') {
  const base = requireRoleOrPermission(['supervisor', 'operational', 'financial'], resource, 'manage');
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as JwtUser;
    const role = normalizeRole(user);
    if (role === 'admin' || hasPlatformAccess(user)) return;
    if (role === 'operational') return;

    const perms = await effectivePermissions(user);
    if (hasResourcePermission({ ...user, permissions: perms }, resource, 'manage')) return;

    if (resource === 'drivers') {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      if (await isOperationalAnalyst(supabase, user)) return;
    }

    return base(request, reply);
  };
}

/** Criar, editar e bloquear contatos. */
export const requireContactsManage = requireRoleOrPermission(
  ['attendant', 'supervisor', 'operational', 'financial'],
  'contacts',
  'manage'
);

/** Permissão de transferência de conversas entre setores/atendentes. */
export const requireConversationsTransfer = requireRoleOrPermission(
  ['attendant', 'supervisor', 'operational', 'financial', 'sales', 'commercial'],
  'conversations',
  'transfer',
);

/** Relatórios operacionais (GET /api/reports/* exceto financeiro). */
export const requireReportsView = requireRoleOrPermission(['supervisor', 'financial'], 'reports', 'view');
