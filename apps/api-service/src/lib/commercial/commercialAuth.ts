import type { FastifyReply, FastifyRequest } from 'fastify';
import { hasPlatformAccess, requireWorkspace, type JwtUser } from '../workspaceContext';
import { readWorkspaceSetting } from '../workspaceSettings';

export const COMMERCIAL_ACCESS_ROLES = ['admin', 'supervisor', 'sales', 'commercial'] as const;

function parseWorkspaceBooleanSetting(v: unknown, defaultValue: boolean): boolean {
  if (v === null || v === undefined) return defaultValue;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v !== '0' && v !== 'false' && v.toLowerCase() !== 'false';
  return Boolean(v);
}

export async function isCommercialCrmEnabled(workspaceId: string): Promise<boolean> {
  const v = await readWorkspaceSetting(workspaceId, 'commercial_crm_enabled');
  return parseWorkspaceBooleanSetting(v, false);
}

export async function isCommercialProposalsEnabled(workspaceId: string): Promise<boolean> {
  const v = await readWorkspaceSetting(workspaceId, 'commercial_proposals_enabled');
  return parseWorkspaceBooleanSetting(v, false);
}

export function requireCommercialProposals() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const enabled = await isCommercialProposalsEnabled(workspaceId);
    if (!enabled) {
      return reply.status(403).send({
        error: 'Propostas temporariamente desabilitadas',
        code: 'COMMERCIAL_PROPOSALS_DISABLED',
      });
    }
  };
}

export function requireCommercialModule() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const enabled = await isCommercialCrmEnabled(workspaceId);
    if (!enabled) {
      return reply.status(403).send({ error: 'Módulo CRM Comercial não habilitado neste workspace.' });
    }
  };
}

export function requireCommercialRole() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as JwtUser;
    const role = String(user.role || user.workspace_role || '').toLowerCase();
    if (!COMMERCIAL_ACCESS_ROLES.includes(role as (typeof COMMERCIAL_ACCESS_ROLES)[number]) && !hasPlatformAccess(user)) {
      return reply.status(403).send({ error: 'Acesso negado ao módulo comercial' });
    }
  };
}

export function requireCommercialSettings() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as JwtUser;
    const role = String(user.role || user.workspace_role || '').toLowerCase();
    if (role !== 'admin' && role !== 'supervisor' && !hasPlatformAccess(user)) {
      return reply.status(403).send({ error: 'Apenas administradores podem alterar configurações comerciais.' });
    }
  };
}
