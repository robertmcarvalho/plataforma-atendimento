import type { SupabaseClient } from '@supabase/supabase-js';

export const PRESENCE_SETTING_KEY = 'user_presence';
export const PRESENCE_IDLE_MS = 5 * 60 * 1000;

export type PresenceValue = 'online' | 'offline';
export type PresenceState = 'online' | 'idle' | 'offline';

export type PresenceRow = { presence: PresenceValue; updated_at: string };

const MEMORY_PRESENCE = new Map<string, PresenceValue>();

export function resolvePresenceState(
  row: PresenceRow | undefined,
  nowMs = Date.now()
): PresenceState {
  if (!row) return 'offline';
  if (row.presence === 'offline') return 'offline';
  const updated = new Date(row.updated_at).getTime();
  if (Number.isNaN(updated)) return 'offline';
  if (nowMs - updated > PRESENCE_IDLE_MS) return 'idle';
  return 'online';
}

export async function readPresenceMap(
  db: SupabaseClient,
  workspaceId: string
): Promise<Record<string, PresenceRow>> {
  const { data, error } = await db
    .from('app_settings')
    .select('value')
    .eq('workspace_id', workspaceId)
    .eq('key', PRESENCE_SETTING_KEY)
    .maybeSingle();

  if (error) {
    if ((error.message || '').includes('app_settings') && (error.message || '').includes('does not exist')) {
      return {};
    }
    if ((error.message || '').toLowerCase().includes('0 rows')) return {};
    return {};
  }

  const value = (data as { value?: unknown } | null)?.value;
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, PresenceRow>;
}

export async function writePresenceMap(
  db: SupabaseClient,
  workspaceId: string,
  map: Record<string, PresenceRow>
): Promise<void> {
  const { error } = await db
    .from('app_settings')
    .upsert(
      { workspace_id: workspaceId, key: PRESENCE_SETTING_KEY, value: map, updated_at: new Date().toISOString() },
      { onConflict: 'workspace_id,key' }
    );

  if (error) {
    if ((error.message || '').includes('app_settings') && (error.message || '').includes('does not exist')) {
      return;
    }
    throw error;
  }
}

export function memoryPresenceGet(userId: string): PresenceValue | undefined {
  return MEMORY_PRESENCE.get(userId);
}

export function memoryPresenceSet(userId: string, presence: PresenceValue): void {
  MEMORY_PRESENCE.set(userId, presence);
}

export type TeamPresenceMember = {
  user_id: string;
  name: string;
  presence: PresenceState;
  updated_at: string | null;
};

export async function buildTeamPresence(
  db: SupabaseClient,
  workspaceId: string,
  userIds: Array<{ id: string; name: string }>
): Promise<{ members: TeamPresenceMember[]; online_count: number; idle_count: number; total: number }> {
  const map = await readPresenceMap(db, workspaceId);
  const nowMs = Date.now();
  const members: TeamPresenceMember[] = userIds.map((u) => {
    const row = map[u.id];
    const presence = resolvePresenceState(row, nowMs);
    return {
      user_id: u.id,
      name: u.name,
      presence,
      updated_at: row?.updated_at ?? null,
    };
  });
  const online_count = members.filter((m) => m.presence === 'online').length;
  const idle_count = members.filter((m) => m.presence === 'idle').length;
  return { members, online_count, idle_count, total: members.length };
}
