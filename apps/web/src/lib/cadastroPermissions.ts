import { MACRO_SECTOR_NAMES } from '@/lib/integrations/operationalSectorsQueuesPreset';

export type CadastroResource = 'pharmacies' | 'drivers' | 'leaders';

export function canManageCadastro(
  role: string | undefined,
  hasPermission: (resource: string, action: string) => boolean,
  resource: CadastroResource,
  opts?: { sectorNames?: string[] }
): boolean {
  const r = String(role || '').toLowerCase();
  if (r === 'admin' || r === 'operational' || r === 'supervisor' || r === 'financial') return true;
  if (
    resource === 'drivers' &&
    r === 'attendant' &&
    opts?.sectorNames?.includes(MACRO_SECTOR_NAMES[0])
  ) {
    return true;
  }
  return hasPermission(resource, 'manage');
}
