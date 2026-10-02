import { sidebarHrefsForRole, roleHasSettingsAccess } from '@/lib/roleNav';
import { isCommercialCrmEnabled, roleCanAccessCommercial } from '@/lib/commercial/commercialAccess';
import { isBillingModuleEnabled, roleCanAccessBilling } from '@/lib/billing/billingAccess';
import {
  isFinancialAuditorBillingPath,
  isFinancialAuditorRole,
} from '@/lib/billing/billingFinancialAuth';

const PLATFORM_PREFIXES = ['/platform'];

function normalizePath(pathname: string) {
  const base = pathname.split('?')[0]?.split('#')[0] || '/';
  if (base.length > 1 && base.endsWith('/')) return base.slice(0, -1);
  return base;
}

/** Returns redirect target when role cannot access path, or null if allowed. */
export function redirectForRoleOnPath(
  role: string | undefined,
  pathname: string,
  permissions?: Record<string, unknown>
): string | null {
  const path = normalizePath(pathname);
  const r = String(role || '').toLowerCase();

  if (r === 'leader') {
    if (path.startsWith('/lider') || path.startsWith('/leader')) return null;
    return '/lider';
  }

  if (PLATFORM_PREFIXES.some((p) => path.startsWith(p))) {
    if (r === 'admin' || r === 'platform_admin' || r === 'platform_owner') return null;
    return '/inbox';
  }

  if (path.startsWith('/commercial')) {
    if (!isCommercialCrmEnabled()) return '/inbox';
    if (!roleCanAccessCommercial(r)) return '/inbox';
    return null;
  }

  if (path.startsWith('/billing')) {
    if (!isBillingModuleEnabled()) return '/inbox';
    if (!roleCanAccessBilling(r, permissions)) return '/inbox';
    if (isFinancialAuditorRole(r) && !isFinancialAuditorBillingPath(path)) {
      return '/billing/conciliacao';
    }
    return null;
  }

  if (path.startsWith('/settings') && !roleHasSettingsAccess(r)) {
    return '/inbox';
  }

  if (isFinancialAuditorRole(r)) {
    return '/billing/conciliacao';
  }

  const allowed = sidebarHrefsForRole(r, permissions);
  if (allowed === 'all') return null;

  if (allowed.some((href) => path === href || path.startsWith(`${href}/`))) return null;

  // Deep links under allowed sections (e.g. /drivers/[id])
  const section = allowed.find((href) => {
    const sectionName = href.split('/').filter(Boolean)[0];
    return sectionName && path.startsWith(`/${sectionName}/`);
  });
  if (section) return null;

  return allowed[0] || '/inbox';
}
