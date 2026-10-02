import { FastifyRequest, FastifyReply } from 'fastify';
import { hasPlatformAccess, type JwtUser } from '../lib/workspaceContext';
import { roleMatchesAny } from '../lib/roleAliases';

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: 'Não autorizado' });
  }
}

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as JwtUser & { workspace_roles?: string[] };
    const role = String(user.role || user.workspace_role || '').trim();
    if (!roleMatchesAny(role, roles, user.workspace_roles) && role !== 'admin' && !hasPlatformAccess(user)) {
      return reply.status(403).send({ error: 'Acesso negado' });
    }
  };
}

export function requirePlatformRole(...roles: Array<'platform_admin' | 'platform_owner'>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as JwtUser;
    const platformRole = String(user.platform_role || '').trim();
    if (!roles.includes(platformRole as 'platform_admin' | 'platform_owner')) {
      return reply.status(403).send({ error: 'Acesso negado' });
    }
  };
}
