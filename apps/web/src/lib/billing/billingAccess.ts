import { hasResourcePermission } from '@/lib/permissions';

/** Papéis com acesso ao módulo /billing (alinhado ao financeiro operacional). */
export const BILLING_ACCESS_ROLES = new Set(['admin', 'supervisor', 'financial', 'financial_auditor']);

const CACHE_KEY = 'billing_module_enabled_cache';

let cachedEnabled: boolean | null = null;

export function setBillingModuleEnabledCache(enabled: boolean) {
  cachedEnabled = enabled;
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(CACHE_KEY, enabled ? '1' : '0');
  }
}

/** Leitura síncrona para sidebar/guards até o layout confirmar via API. */
export function isBillingModuleEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled;
  if (typeof window !== 'undefined') {
    const v = sessionStorage.getItem(CACHE_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  }
  const raw = process.env.NEXT_PUBLIC_BILLING_MODULE_ENABLED?.trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  return process.env.NODE_ENV !== 'production';
}

/**
 * Acesso ao /billing: papéis financeiros nativos, ou permissões granulares
 * `billing.view` / `billing.manage` / `financial.view` (legado alinhado ao roleNav).
 */
export function roleCanAccessBilling(
  role: string | undefined,
  permissions?: Record<string, unknown>
): boolean {
  const r = String(role || '').toLowerCase();
  if (r === 'admin' || r === 'supervisor') return true;
  if (BILLING_ACCESS_ROLES.has(r)) return true;
  if (hasResourcePermission(permissions, 'billing', 'view')) return true;
  if (hasResourcePermission(permissions, 'billing', 'manage')) return true;
  if (hasResourcePermission(permissions, 'financial', 'view')) return true;
  return false;
}
