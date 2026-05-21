import type { SupabaseClient } from '@supabase/supabase-js';

export type SectorPair = { sector_id: string; is_primary: boolean };

export async function replaceUserSectors(
  db: SupabaseClient,
  userId: string,
  pairs: SectorPair[],
  workspaceId?: string | null
): Promise<void> {
  let deleteQuery = db.from('user_sectors').delete().eq('user_id', userId);
  if (workspaceId) deleteQuery = deleteQuery.eq('workspace_id', workspaceId);
  await deleteQuery;
  if (!pairs.length) return;
  const now = new Date().toISOString();
  const { error } = await db.from('user_sectors').insert(
    pairs.map((s) => ({
      ...(workspaceId ? { workspace_id: workspaceId } : {}),
      user_id: userId,
      sector_id: s.sector_id,
      is_primary: s.is_primary,
      updated_at: now,
    }))
  );
  if (error) throw new Error(error.message);
}

export async function listSectorIdsForUser(db: SupabaseClient, userId: string, workspaceId?: string | null): Promise<string[]> {
  let query = db.from('user_sectors').select('sector_id').eq('user_id', userId);
  if (workspaceId) query = query.eq('workspace_id', workspaceId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((r) => r.sector_id).filter(Boolean) as string[];
}

export function buildSectorPairs(input: {
  sector_ids?: string[] | null;
  primary_sector_id?: string | null;
  sector_id?: string | null;
}): { pairs: SectorPair[]; primarySectorId: string | null } {
  let ids = Array.isArray(input.sector_ids) ? input.sector_ids.filter(Boolean) : [];
  if (!ids.length && input.sector_id) ids = [input.sector_id];
  ids = [...new Set(ids)];
  let primary =
    input.primary_sector_id && ids.includes(input.primary_sector_id)
      ? input.primary_sector_id
      : ids[0] || null;
  const pairs: SectorPair[] = ids.map((id) => ({
    sector_id: id,
    is_primary: primary ? id === primary : false,
  }));
  if (pairs.length && !pairs.some((p) => p.is_primary)) {
    pairs[0] = { ...pairs[0], is_primary: true };
    primary = pairs[0].sector_id;
  }
  return { pairs, primarySectorId: primary };
}
