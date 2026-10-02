/** Papéis com comportamento de atendente (fila, inbox por setor, operação execução). */
export const ATTENDANT_LIKE_ROLES = new Set(['attendant', 'attendant_financeiro']);

export function isAttendantLikeRole(role: string | undefined | null): boolean {
  return ATTENDANT_LIKE_ROLES.has(String(role || '').toLowerCase());
}
