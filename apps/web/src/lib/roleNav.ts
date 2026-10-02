/**
 * Navegação e acesso a /settings por papel — alinhado às rotas da API.
 * Permissões granulares do perfil (ex.: financial.view) complementam o papel.
 * Ver também docs/access-matrix-by-role.md
 */

import { hasResourcePermission } from '@/lib/permissions';
import { isAttendantLikeRole } from '@/lib/roleAliases';

const SUPERVISOR_SIDEBAR = [
  '/inbox',
  '/dashboard',
  '/operacao',
  '/commercial',
  '/commercial/pipeline',
  '/commercial/leads',
  '/commercial/settings',
  '/reports',
  '/contacts',
  '/pharmacies',
  '/drivers',
  '/leaders',
  '/campaigns',
  '/financial',
  '/billing',
  '/settings',
] as const;

const FINANCIAL_SIDEBAR = [
  '/inbox',
  '/operacao',
  '/contacts',
  '/dashboard',
  '/reports',
  '/pharmacies',
  '/drivers',
  '/leaders',
  '/financial',
  '/billing',
  '/settings',
] as const;

/** Auditor financeiro: só módulo billing (subnav filtrada). */
const FINANCIAL_AUDITOR_SIDEBAR = ['/billing'] as const;

const OPERATIONAL_SIDEBAR = [
  '/inbox',
  '/operacao',
  '/contacts',
  '/pharmacies',
  '/drivers',
  '/leaders',
  '/financial',
  '/settings',
] as const;

const ATTENDANT_SIDEBAR = ['/inbox', '/operacao', '/contacts', '/pharmacies', '/drivers', '/leaders', '/settings'] as const;

const COMMERCIAL_SIDEBAR = [
  '/inbox',
  '/commercial',
  '/commercial/pipeline',
  '/commercial/leads',
  '/commercial/settings',
  '/contacts',
  '/settings',
] as const;

export function roleHasSettingsAccess(role: string | undefined): boolean {
  const r = String(role || '').toLowerCase();
  return r !== 'leader' && r !== 'financial_auditor';
}

function extendSidebarForPermissions(
  hrefs: readonly string[],
  permissions?: Record<string, unknown>
): readonly string[] {
  const next = [...hrefs];
  if (hasResourcePermission(permissions, 'financial', 'view') && !next.includes('/financial')) {
    next.push('/financial');
  }
  if (
    (hasResourcePermission(permissions, 'billing', 'view') ||
      hasResourcePermission(permissions, 'billing', 'manage') ||
      hasResourcePermission(permissions, 'financial', 'view')) &&
    !next.includes('/billing')
  ) {
    next.push('/billing');
  }
  if (hasResourcePermission(permissions, 'reports', 'view') && !next.includes('/reports')) {
    next.push('/reports');
  }
  const cadastroHrefs: Array<[resource: string, href: string]> = [
    ['contacts', '/contacts'],
    ['pharmacies', '/pharmacies'],
    ['drivers', '/drivers'],
    ['leaders', '/leaders'],
  ];
  for (const [resource, href] of cadastroHrefs) {
    if (
      (hasResourcePermission(permissions, resource, 'view') || hasResourcePermission(permissions, resource, 'manage')) &&
      !next.includes(href)
    ) {
      next.push(href);
    }
  }
  return next;
}

/** Para perfis que não são `leader`: quais hrefs do menu principal são exibidos. */
export function sidebarHrefsForRole(
  role: string | undefined,
  permissions?: Record<string, unknown>
): 'all' | readonly string[] {
  const r = String(role || '').toLowerCase();
  if (r === 'admin') return 'all';
  if (r === 'supervisor') return SUPERVISOR_SIDEBAR;
  if (r === 'financial') return FINANCIAL_SIDEBAR;
  if (r === 'financial_auditor') return FINANCIAL_AUDITOR_SIDEBAR;
  if (r === 'operational') return OPERATIONAL_SIDEBAR;
  if (isAttendantLikeRole(r)) return extendSidebarForPermissions(ATTENDANT_SIDEBAR, permissions);
  if (r === 'operational') return extendSidebarForPermissions(OPERATIONAL_SIDEBAR, permissions);
  if (r === 'sales' || r === 'commercial') return extendSidebarForPermissions(COMMERCIAL_SIDEBAR, permissions);
  return 'all';
}
