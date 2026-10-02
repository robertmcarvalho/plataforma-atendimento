import type { SupabaseClient } from '@supabase/supabase-js';

export const TASK_SECTOR_NAMES = {
  ATENDIMENTO_GERAL: 'Atendimento Geral',
  FINANCEIRO: 'Financeiro',
  OPERACIONAL: 'Operacional',
} as const;

const OPEN_TASK_STATUSES = ['open', 'in_progress'] as const;

export async function resolveSectorIdByName(
  db: SupabaseClient,
  workspaceId: string,
  sectorName: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('sectors')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('name', sectorName)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ? String(data.id) : null;
}

export async function resolveSectorIdsByNames(
  db: SupabaseClient,
  workspaceId: string,
  names: string[],
): Promise<Record<string, string | null>> {
  const out = Object.fromEntries(names.map((n) => [n, null])) as Record<string, string | null>;
  if (!workspaceId || !names.length) return out;
  const { data, error } = await db
    .from('sectors')
    .select('id, name')
    .eq('workspace_id', workspaceId)
    .in('name', names);
  if (error) throw new Error(error.message);
  for (const row of data || []) {
    const name = String(row.name || '');
    if (name in out) out[name] = String(row.id);
  }
  return out;
}

async function listActiveUserIdsInSector(
  db: SupabaseClient,
  workspaceId: string,
  sectorId: string,
): Promise<string[]> {
  const { data: links, error } = await db
    .from('user_sectors')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('sector_id', sectorId);
  if (error) throw new Error(error.message);
  const userIds = Array.from(new Set((links || []).map((row) => String(row.user_id)).filter(Boolean)));
  if (!userIds.length) return [];

  const { data: users, error: usersErr } = await db
    .from('users')
    .select('id, is_active')
    .in('id', userIds);
  if (usersErr) throw new Error(usersErr.message);
  return (users || [])
    .filter((u) => u.is_active !== false)
    .map((u) => String(u.id));
}

async function countOpenTasksByAssignees(
  db: SupabaseClient,
  workspaceId: string,
  assigneeIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const id of assigneeIds) counts.set(id, 0);
  if (!assigneeIds.length) return counts;

  const { data, error } = await db
    .from('pending_tasks')
    .select('assignee_id')
    .eq('workspace_id', workspaceId)
    .in('assignee_id', assigneeIds)
    .in('status', [...OPEN_TASK_STATUSES]);
  if (error) throw new Error(error.message);

  for (const row of data || []) {
    const id = String(row.assignee_id || '');
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

/** Escolhe o atendente ativo do setor com menos tarefas em aberto. */
export async function resolveLeastOpenAssigneeInSector(
  db: SupabaseClient,
  workspaceId: string,
  sectorName: string,
): Promise<{ assigneeId: string | null; sectorId: string | null }> {
  const sectorId = await resolveSectorIdByName(db, workspaceId, sectorName);
  if (!sectorId) return { assigneeId: null, sectorId: null };

  const candidateIds = await listActiveUserIdsInSector(db, workspaceId, sectorId);
  if (!candidateIds.length) return { assigneeId: null, sectorId };

  const counts = await countOpenTasksByAssignees(db, workspaceId, candidateIds);
  let bestId = candidateIds[0]!;
  let bestCount = counts.get(bestId) ?? 0;
  for (const id of candidateIds.slice(1)) {
    const count = counts.get(id) ?? 0;
    if (count < bestCount) {
      bestId = id;
      bestCount = count;
    }
  }
  return { assigneeId: bestId, sectorId };
}
