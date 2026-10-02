/** Espelha hasResourcePermission da API — checagens de UI sem depender do papel fixo. */
export function hasResourcePermission(
  permissions: Record<string, unknown> | undefined,
  resource: string,
  action: string
): boolean {
  if (!permissions || typeof permissions !== 'object') return false;
  if (permissions.all === true) return true;
  const group = permissions[resource];
  return typeof group === 'object' && group !== null && (group as Record<string, boolean>)[action] === true;
}
