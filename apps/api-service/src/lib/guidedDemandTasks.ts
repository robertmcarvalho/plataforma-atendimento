import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';

export const ATTENDANCE_PENDING_TASK_TYPES = ['queue_sla_treatment', 'guided_demand'] as const;

export async function resolveDemandTitle(
  db: SupabaseClient,
  workspaceId: string,
  demandKey: string
): Promise<string | null> {
  const { data } = await db
    .from('workspace_sector_demands')
    .select('title')
    .eq('workspace_id', workspaceId)
    .eq('demand_key', demandKey)
    .maybeSingle();
  return (data?.title as string | undefined) || null;
}

export async function upsertGuidedDemandTask(
  db: SupabaseClient,
  args: {
    conversationId: string;
    demandKey: string;
    demandTitle: string;
    sectorName?: string | null;
    dueAt?: string | null;
    assigneeId?: string | null;
    sectorId?: string | null;
  }
): Promise<void> {
  const { data: conv } = await db
    .from('conversations')
    .select('attendant_id, sector_id, intent_sector_id, sla_treatment_deadline, workspace_id')
    .eq('id', args.conversationId)
    .maybeSingle();
  if (!conv) return;

  const assigneeId = args.assigneeId ?? (conv.attendant_id as string | null) ?? null;
  const sectorId =
    args.sectorId ?? (conv.sector_id as string | null) ?? (conv.intent_sector_id as string | null) ?? null;
  const dueAt = args.dueAt ?? (conv.sla_treatment_deadline as string | null) ?? null;

  const { data: existing } = await db
    .from('pending_tasks')
    .select('id')
    .eq('task_type', 'guided_demand')
    .eq('conversation_id', args.conversationId)
    .in('status', ['open', 'in_progress'])
    .limit(1)
    .maybeSingle();

  const sectorLabel = args.sectorName?.trim() || 'Triagem guiada';
  const payload: Record<string, unknown> = {
    title: args.demandTitle,
    description: `Demanda registrada no setor ${sectorLabel}.`,
    priority: 'high',
    due_at: dueAt,
    metadata: {
      demand_key: args.demandKey,
      demand_title: args.demandTitle,
      sector_name: sectorLabel,
    },
    updated_at: new Date().toISOString(),
  };
  if (assigneeId) payload.assignee_id = assigneeId;
  if (sectorId) payload.sector_id = sectorId;

  if (existing?.id) {
    await db.from('pending_tasks').update(payload).eq('id', existing.id);
    return;
  }

  await db.from('pending_tasks').insert({
    task_type: 'guided_demand',
    status: 'open',
    source: 'system',
    conversation_id: args.conversationId,
    workspace_id: conv.workspace_id,
    ...payload,
  });
}

/** Cria pendência explícita da demanda se a conversa já tiver `demand_key` (backfill). */
export async function ensureGuidedDemandTaskForConversation(
  db: SupabaseClient,
  workspaceId: string,
  conversationId: string
): Promise<void> {
  const { data: conv } = await db
    .from('conversations')
    .select('id, demand_key, status, sector_id, intent_sector_id, attendant_id, sla_treatment_deadline')
    .eq('workspace_id', workspaceId)
    .eq('id', conversationId)
    .maybeSingle();
  if (!conv?.demand_key) return;
  if (['resolved', 'closed'].includes(String(conv.status || ''))) return;

  const demandKey = String(conv.demand_key);
  const title = (await resolveDemandTitle(db, workspaceId, demandKey)) || demandKey;

  let sectorName: string | null = null;
  const sectorId = (conv.sector_id as string | null) || (conv.intent_sector_id as string | null);
  if (sectorId) {
    const { data: sector } = await db.from('sectors').select('name').eq('id', sectorId).maybeSingle();
    sectorName = (sector?.name as string | undefined) || null;
  }

  await upsertGuidedDemandTask(db, {
    conversationId,
    demandKey,
    demandTitle: title,
    sectorName,
    dueAt: (conv.sla_treatment_deadline as string | null) ?? null,
    assigneeId: (conv.attendant_id as string | null) ?? null,
    sectorId,
  });
}

export async function closeGuidedDemandTasksOnResolve(db: SupabaseClient, conversationId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .from('pending_tasks')
    .update({ status: 'done', completed_at: now, updated_at: now })
    .eq('conversation_id', conversationId)
    .eq('task_type', 'guided_demand')
    .in('status', ['open', 'in_progress']);
}

export { supabase };
