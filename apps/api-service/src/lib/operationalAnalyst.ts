import type { SupabaseClient } from '@supabase/supabase-js';
import { sectorIdsFromJwt } from './jwtSectorIds';

const OPERACIONAL_SECTOR = 'Operacional';

export async function isOperationalAnalyst(
  db: SupabaseClient,
  user: { role?: string; sector_id?: string | null; sector_ids?: string[] }
): Promise<boolean> {
  const role = String(user.role || '').trim().toLowerCase();
  if (role === 'operational') return true;
  if (role !== 'attendant') return false;

  const sectorIds = sectorIdsFromJwt(user);
  if (!sectorIds.length) return false;

  const { data, error } = await db.from('sectors').select('name').in('id', sectorIds);
  if (error) return false;
  return (data || []).some((row) => String(row.name || '').trim() === OPERACIONAL_SECTOR);
}
