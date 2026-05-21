import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { ATTENDANCE_PENDING_TASK_TYPES } from './guidedDemandTasks';

const MAX_CONV_IN_OR = 120;

export { ATTENDANCE_PENDING_TASK_TYPES };

/** Cláusula PostgREST `.or()` para pendências visíveis a um atendente. */
export async function buildAttendantPendingTasksOr(
  db: SupabaseClient,
  workspaceId: string,
  user: { sub: string; sector_id?: string | null; sector_ids?: string[] },
  sectorIds: string[]
): Promise<string> {
  const parts: string[] = [`assignee_id.eq.${user.sub}`];

  if (sectorIds.length) {
    parts.push(...sectorIds.map((sid) => `sector_id.eq.${sid}`));
  } else if (user.sector_id) {
    parts.push(`sector_id.eq.${user.sector_id}`);
  } else {
    parts.push('sector_id.is.null');
  }

  const { data: assignedConvs } = await db
    .from('conversations')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('attendant_id', user.sub)
    .in('status', ['open', 'pending'])
    .limit(800);

  const convIds = (assignedConvs || []).map((c: { id: string }) => c.id).filter(Boolean);
  for (let i = 0; i < convIds.length; i += MAX_CONV_IN_OR) {
    const chunk = convIds.slice(i, i + MAX_CONV_IN_OR);
    if (chunk.length) parts.push(`conversation_id.in.(${chunk.join(',')})`);
  }

  return parts.join(',');
}

export async function buildSupervisorPendingTasksOr(
  db: SupabaseClient,
  workspaceId: string,
  sectorIds: string[]
): Promise<string | null> {
  if (!sectorIds.length) return null;

  const { data: convRows } = await db
    .from('conversations')
    .select('id')
    .eq('workspace_id', workspaceId)
    .in('sector_id', sectorIds)
    .limit(1600);

  const convIds = (convRows || []).map((c: { id: string }) => c.id).filter(Boolean);
  const orClauses: string[] = sectorIds.map((sid) => `sector_id.eq.${sid}`);
  for (let i = 0; i < convIds.length; i += MAX_CONV_IN_OR) {
    const chunk = convIds.slice(i, i + MAX_CONV_IN_OR);
    if (chunk.length) orClauses.push(`conversation_id.in.(${chunk.join(',')})`);
  }
  return orClauses.join(',');
}

/** Sincroniza assignee/setor da pendência com a conversa (ex.: SLA de fila após triagem). */
export async function syncPendingTaskFromConversation(
  db: SupabaseClient,
  conversationId: string,
  taskTypes?: string[]
): Promise<void> {
  const { data: conv } = await db
    .from('conversations')
    .select('attendant_id, sector_id, intent_sector_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conv) return;

  const assigneeId = (conv.attendant_id as string | null) || null;
  const sectorId = (conv.sector_id as string | null) || (conv.intent_sector_id as string | null) || null;
  if (!assigneeId && !sectorId) return;

  let query = db
    .from('pending_tasks')
    .select('id')
    .eq('conversation_id', conversationId)
    .in('status', ['open', 'in_progress']);
  if (taskTypes?.length) query = query.in('task_type', taskTypes);

  const { data: tasks } = await query;
  if (!tasks?.length) return;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (assigneeId) patch.assignee_id = assigneeId;
  if (sectorId) patch.sector_id = sectorId;

  await db
    .from('pending_tasks')
    .update(patch)
    .in(
      'id',
      tasks.map((t: { id: string }) => t.id)
    );
}
