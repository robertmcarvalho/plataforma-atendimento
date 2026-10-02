/** Papéis com acesso ao módulo Comercial. */
export const COMMERCIAL_ACCESS_ROLES = new Set([
  'admin',
  'supervisor',
  'sales',
  'commercial',
]);

export function roleCanAccessCommercial(role: string | undefined): boolean {
  return COMMERCIAL_ACCESS_ROLES.has(String(role || '').toLowerCase());
}

const CACHE_KEY = 'commercial_crm_enabled_cache';

let cachedCrmEnabled: boolean | null = null;

/** Atualiza cache síncrono (sidebar / guards) após fetch de settings. */
export function setCommercialCrmEnabledCache(enabled: boolean) {
  cachedCrmEnabled = enabled;
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(CACHE_KEY, enabled ? '1' : '0');
  }
}

/** Leitura síncrona para navegação; default otimista até o layout confirmar. */
export function isCommercialCrmEnabled(): boolean {
  if (cachedCrmEnabled !== null) return cachedCrmEnabled;
  if (typeof window !== 'undefined') {
    const v = sessionStorage.getItem(CACHE_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  }
  return true;
}
