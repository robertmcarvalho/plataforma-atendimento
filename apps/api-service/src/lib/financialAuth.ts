import { requireRoleOrPermission, hasResourcePermission, effectivePermissions } from './permissions';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { JwtUser } from './workspaceContext';
import { hasPlatformAccess } from './workspaceContext';

function normalizeRole(user: Pick<JwtUser, 'role' | 'workspace_role'>): string {
  return String(user.role || user.workspace_role || '').trim().toLowerCase();
}

/** Leitura de lançamentos, resumos e configuração (GET). */
export const requireFinancialView = requireRoleOrPermission(
  ['financial', 'financial_auditor', 'operational', 'supervisor'],
  'financial',
  'view'
);

/** Criação, edição e fluxo operacional financeiro. */
export const requireFinancialManage = requireRoleOrPermission(['financial', 'supervisor'], 'financial', 'manage');

/** Aprovação e rejeição de lançamentos. */
export const requireFinancialApprove = requireRoleOrPermission(['supervisor'], 'financial', 'approve');

/** Exportação e importação de planilhas. */
export const requireFinancialExport = requireRoleOrPermission(
  ['financial', 'financial_auditor'],
  'financial',
  'export'
);

/**
 * Conciliação de baixas e importação de extrato.
 * Auditor financeiro, gestores com manage, ou permissão `financial.reconcile`.
 */
export async function requireFinancialReconcile(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as JwtUser;
  const role = normalizeRole(user);
  if (role === 'admin' || hasPlatformAccess(user)) return;
  if (role === 'financial_auditor' || role === 'financial' || role === 'supervisor') return;
  const perms = await effectivePermissions(user);
  if (hasResourcePermission({ ...user, permissions: perms }, 'financial', 'reconcile')) return;
  if (hasResourcePermission({ ...user, permissions: perms }, 'financial', 'manage')) return;
  return reply.status(403).send({ error: 'Acesso negado' });
}

/** Cancelamento de adiantamentos (financeiro e gestor/supervisor). */
export const requireFinancialCancelAdvance = requireRoleOrPermission(
  ['financial', 'supervisor'],
  'financial',
  'manage'
);
