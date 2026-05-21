import { FastifyRequest, FastifyReply } from 'fastify';
import { hasPlatformAccess, type JwtUser } from '../lib/workspaceContext';

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ error: 'Não autorizado' });
  }
}

export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as JwtUser;
    const role = String(user.role || user.workspace_role || '').trim();
    if (!roles.includes(role) && role !== 'admin' && !hasPlatformAccess(user)) {
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
