export type CadastroResource = 'pharmacies' | 'drivers' | 'leaders';

export function canManageCadastro(
  role: string | undefined,
  hasPermission: (resource: string, action: string) => boolean,
  resource: CadastroResource
): boolean {
  const r = String(role || '').toLowerCase();
  if (r === 'admin' || r === 'operational') return true;
  return hasPermission(resource, 'manage');
}
