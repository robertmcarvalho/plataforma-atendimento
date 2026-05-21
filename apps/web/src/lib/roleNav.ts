/**
 * Navegação e acesso a /settings por papel — alinhado às rotas da API.
 * Ver também docs/access-matrix-by-role.md
 */

const SUPERVISOR_SIDEBAR = [
  '/inbox',
  '/dashboard',
  '/reports',
  '/contacts',
  '/pharmacies',
  '/drivers',
  '/leaders',
  '/campaigns',
  '/financial',
  '/settings',
] as const;

const FINANCIAL_SIDEBAR = [
  '/inbox',
  '/contacts',
  '/dashboard',
  '/reports',
  '/pharmacies',
  '/drivers',
  '/leaders',
  '/financial',
  '/settings',
] as const;

const OPERATIONAL_SIDEBAR = [
  '/inbox',
  '/contacts',
  '/pharmacies',
  '/drivers',
  '/leaders',
  '/financial',
  '/settings',
] as const;

const ATTENDANT_SIDEBAR = ['/inbox', '/contacts', '/pharmacies', '/drivers', '/leaders', '/settings'] as const;

export function roleHasSettingsAccess(role: string | undefined): boolean {
  const r = String(role || '').toLowerCase();
  return r !== 'leader';
}

/** Para perfis que não são `leader`: quais hrefs do menu principal são exibidos. */
export function sidebarHrefsForRole(role: string | undefined): 'all' | readonly string[] {
  const r = String(role || '').toLowerCase();
  if (r === 'admin') return 'all';
  if (r === 'supervisor') return SUPERVISOR_SIDEBAR;
  if (r === 'financial') return FINANCIAL_SIDEBAR;
  if (r === 'operational') return OPERATIONAL_SIDEBAR;
  if (r === 'attendant') return ATTENDANT_SIDEBAR;
  return 'all';
}
