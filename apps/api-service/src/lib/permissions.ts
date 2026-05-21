import type { FastifyReply, FastifyRequest } from 'fastify';
import { getWorkspaceMembership, hasPlatformAccess, type JwtUser } from './workspaceContext';

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

/** Cadastro: admin, operational (legado) ou permissão `manage` do perfil (JWT ou DB atual). */
export function requireCadastroManage(resource: 'pharmacies' | 'drivers' | 'leaders') {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as JwtUser;
    const role = String(user.role || user.workspace_role || '').trim();
    if (role === 'operational') return;
    const perms = await effectivePermissions(user);
    if (hasResourcePermission({ ...user, permissions: perms }, resource, 'manage')) return;
    return reply.status(403).send({ error: 'Acesso negado' });
  };
}
