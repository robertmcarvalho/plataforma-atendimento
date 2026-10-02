import { hasResourcePermission } from '@/lib/permissions';

const CONTACTS_MANAGE_ROLES = new Set(['admin', 'attendant', 'supervisor', 'operational', 'financial']);

/** Espelha requireContactsManage da API. */
export function canManageContacts(
  role: string | undefined,
  permissions?: Record<string, unknown>
): boolean {
  const r = String(role || '').toLowerCase();
  if (CONTACTS_MANAGE_ROLES.has(r)) return true;
  return hasResourcePermission(permissions, 'contacts', 'manage');
}
