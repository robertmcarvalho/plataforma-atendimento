import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeaderFinancialReviewContext } from './leaderFinancialDemandContext';
import { formatTaskNotificationSummary } from './advanceDecisionFollowup';
import { isTaskTypeCreatableForWorkspace } from './opsTaskCatalog';
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

export async function upsertFinancialAdvanceRequestTask(
  db: SupabaseClient,
  args: {
    workspaceId: string;
    conversationId: string;
    driverId: string;
    driverName?: string | null;
    demandTitle: string;
    sectorId?: string | null;
    financialReview?: LeaderFinancialReviewContext | Record<string, unknown> | null;
    requestedAmount?: number | null;
    requestReason?: string | null;
  }
): Promise<void> {
  const { data: existing } = await db
    .from('pending_tasks')
    .select('id')
    .eq('task_type', 'financial_advance_request')
    .eq('conversation_id', args.conversationId)
    .in('status', ['open', 'in_progress'])
    .limit(1)
    .maybeSingle();

  const finReview = args.financialReview as LeaderFinancialReviewContext | null | undefined;
  const summary = formatTaskNotificationSummary(finReview ?? null, args.driverName || 'Entregador', {
    requestedAmount: args.requestedAmount,
    requestReason: args.requestReason,
  });

  const payload: Record<string, unknown> = {
    title: args.demandTitle,
    description: summary,
    priority: 'high',
    driver_id: args.driverId,
    sector_id: args.sectorId ?? null,
    metadata: {
      source: 'portal_lider',
      phase: 'review',
      demand_title: args.demandTitle,
      notification_summary: summary,
      ...(args.requestedAmount != null ? { requested_amount: args.requestedAmount } : {}),
      ...(args.requestReason ? { request_reason: args.requestReason } : {}),
      ...(args.financialReview ? { financial_review: args.financialReview } : {}),
    },
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    await db.from('pending_tasks').update(payload).eq('id', existing.id);
    return;
  }

  const allowed = await isTaskTypeCreatableForWorkspace(
    db,
    args.workspaceId,
    'financial_advance_request',
    'guided_demand'
  );
  if (!allowed) return;

  await db.from('pending_tasks').insert({
    task_type: 'financial_advance_request',
    status: 'open',
    source: 'system',
    conversation_id: args.conversationId,
    workspace_id: args.workspaceId,
    ...payload,
  });
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
    driverId?: string | null;
    metadataExtra?: Record<string, unknown>;
  }
): Promise<void> {
  const { data: conv } = await db
    .from('conversations')
    .select(
      'attendant_id, sector_id, intent_sector_id, sla_treatment_deadline, workspace_id, context_driver_id'
    )
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
  const driverId = args.driverId ?? (conv.context_driver_id as string | null) ?? null;
  const payload: Record<string, unknown> = {
    title: args.demandTitle,
    description: `Demanda registrada no setor ${sectorLabel}.`,
    priority: 'high',
    due_at: dueAt,
    metadata: {
      demand_key: args.demandKey,
      demand_title: args.demandTitle,
      sector_name: sectorLabel,
      ...(args.metadataExtra || {}),
    },
    updated_at: new Date().toISOString(),
  };
  if (assigneeId) payload.assignee_id = assigneeId;
  if (sectorId) payload.sector_id = sectorId;
  if (driverId) payload.driver_id = driverId;

  if (existing?.id) {
    await db.from('pending_tasks').update(payload).eq('id', existing.id);
    return;
  }

  const workspaceId = String(conv.workspace_id || '');
  if (!workspaceId) return;
  const allowed = await isTaskTypeCreatableForWorkspace(db, workspaceId, 'guided_demand', 'guided_demand');
  if (!allowed) return;

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
    .select(
      'id, demand_key, status, sector_id, intent_sector_id, attendant_id, sla_treatment_deadline, context_driver_id'
    )
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
    driverId: (conv.context_driver_id as string | null) ?? null,
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
