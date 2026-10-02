/** Papéis com comportamento de atendente (fila, inbox por setor, operação execução). */
export const ATTENDANT_LIKE_ROLES = new Set(['attendant', 'attendant_financeiro']);

export function isAttendantLikeRole(role: string | undefined | null): boolean {
  return ATTENDANT_LIKE_ROLES.has(String(role || '').toLowerCase());
}

export function expandAttendantRoles(roles: string[]): string[] {
  const out = new Set(roles.map((r) => r.toLowerCase()));
  if (out.has('attendant')) out.add('attendant_financeiro');
  return [...out];
}

export function roleMatchesAny(
  userRole: string | undefined | null,
  allowed: string[],
  userRoles?: string[] | null
): boolean {
  const expanded = expandAttendantRoles(allowed.map((r) => r.toLowerCase()));
  const candidates = new Set<string>();
  const primary = String(userRole || '').toLowerCase();
  if (primary) candidates.add(primary);
  for (const r of userRoles || []) {
    const name = String(r || '').toLowerCase();
    if (name) candidates.add(name);
  }
  for (const c of candidates) {
    if (expanded.includes(c)) return true;
  }
  return false;
}
