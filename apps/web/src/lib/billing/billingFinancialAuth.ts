import { hasResourcePermission } from '@/lib/permissions';

export function isFinancialAuditorRole(role: string | undefined | null): boolean {
  return String(role || '').toLowerCase() === 'financial_auditor';
}

/** Mutações operacionais de billing (aprovar acerto, mark_paid, enviar recibo, etc.). */
export function canManageBillingFinancial(
  role: string | undefined | null,
  permissions?: Record<string, unknown>
): boolean {
  const r = String(role || '').toLowerCase();
  if (r === 'admin' || r === 'supervisor' || r === 'financial') return true;
  if (isFinancialAuditorRole(r)) return false;
  if (hasResourcePermission(permissions, 'financial', 'manage')) return true;
  if (hasResourcePermission(permissions, 'billing', 'manage')) return true;
  return false;
}

/** Conciliação + importação de extrato. */
export function canReconcileBillingFinancial(
  role: string | undefined | null,
  permissions?: Record<string, unknown>
): boolean {
  const r = String(role || '').toLowerCase();
  if (r === 'admin' || r === 'supervisor' || r === 'financial' || r === 'financial_auditor') return true;
  if (hasResourcePermission(permissions, 'financial', 'reconcile')) return true;
  if (hasResourcePermission(permissions, 'financial', 'manage')) return true;
  return false;
}

/** Subnav billing liberada para o auditor financeiro. */
export const FINANCIAL_AUDITOR_BILLING_HREFS = [
  '/billing',
  '/billing/acertos',
  '/billing/receber',
  '/billing/pagar',
  '/billing/conciliacao',
  '/billing/relatorios',
  '/billing/dre',
] as const;

export function isFinancialAuditorBillingPath(pathname: string): boolean {
  const path = pathname.split('?')[0]?.split('#')[0] || '/';
  const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  if (normalized === '/billing') return true;
  return FINANCIAL_AUDITOR_BILLING_HREFS.some(
    (href) => href !== '/billing' && (normalized === href || normalized.startsWith(`${href}/`))
  );
}
