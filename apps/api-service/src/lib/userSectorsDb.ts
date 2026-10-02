import type { SupabaseClient } from '@supabase/supabase-js';
import { listWorkspaceChannels } from './workspaceChannels';

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
  const fromTable = (data || []).map((r) => r.sector_id).filter(Boolean) as string[];
  if (fromTable.length || !workspaceId) return fromTable;
  return resolveSectorIdsFromQueueAssignments(db, workspaceId, userId);
}

/** Resolve setores a partir das filas WhatsApp quando user_sectors está vazio ou desatualizado. */
export async function resolveSectorIdsFromQueueAssignments(
  db: SupabaseClient,
  workspaceId: string,
  userId: string
): Promise<string[]> {
  const { data: rows, error } = await db
    .from('user_channel_queue_assignments')
    .select('queue_name')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('is_enabled', true);
  if (error) {
    if ((error.message || '').includes('user_channel_queue_assignments')) return [];
    throw new Error(error.message);
  }

  const queueKeys = [
    ...new Set(
      (rows || [])
        .map((r) => String(r.queue_name || '').trim())
        .filter((n) => n && n !== 'default')
    ),
  ];
  if (!queueKeys.length) return [];

  const ids = new Set<string>();
  const uuidKeys = queueKeys.filter((k) => /^[0-9a-f-]{36}$/i.test(k));
  if (uuidKeys.length) {
    const { data: byId } = await db.from('sectors').select('id').eq('workspace_id', workspaceId).in('id', uuidKeys);
    for (const row of byId || []) ids.add(String(row.id));
  }

  const channels = await listWorkspaceChannels(workspaceId, db).catch(() => []);
  const nameByConfigId = new Map<string, string>();
  for (const channel of channels.filter((c) => c.channel_type === 'whatsapp')) {
    const sectors = Array.isArray(channel.config?.sectors) ? channel.config.sectors : [];
    for (const raw of sectors) {
      const sector = raw as Record<string, unknown>;
      const id = String(sector.id || '').trim();
      const name = String(sector.name || sector.label || '').trim();
      if (id && name) nameByConfigId.set(id, name);
    }
  }

  const names = [
    ...new Set(queueKeys.map((k) => nameByConfigId.get(k) || '').filter(Boolean)),
  ];
  if (names.length) {
    const { data: byName } = await db.from('sectors').select('id').eq('workspace_id', workspaceId).in('name', names);
    for (const row of byName || []) ids.add(String(row.id));
  }

  return [...ids];
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
