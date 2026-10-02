import type { SupabaseClient } from '@supabase/supabase-js';
import { signatureStatusLabel } from '@plataforma/operational-notes';

function isDriverSignedForSettlement(status: string): boolean {
  const s = String(status || '').toLowerCase().trim();
  return s === 'signed' || s === 'document_finished';
}

const TERMINATION_SIGNATURE_TYPES = new Set(['driver_termination_prep', 'driver_termination_request']);

async function resolveFinanceSectorId(db: SupabaseClient, workspaceId: string): Promise<string | null> {
  const { data } = await db
    .from('sectors')
    .select('id')
    .eq('workspace_id', workspaceId)
    .ilike('name', 'Financeiro')
    .limit(1)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

async function resolveFinanceSectorAssigneeId(
  db: SupabaseClient,
  financeSectorId: string | null
): Promise<string | null> {
  if (!financeSectorId) return null;
  const { data: links } = await db
    .from('user_sectors')
    .select('user_id, users!inner(id, is_active)')
    .eq('sector_id', financeSectorId)
    .limit(20);
  for (const row of links || []) {
    const u = row.users as { id?: string; is_active?: boolean } | { id?: string; is_active?: boolean }[];
    const user = Array.isArray(u) ? u[0] : u;
    if (user?.is_active !== false && user?.id) return String(user.id);
  }
  return null;
}

function addBusinessDaysFallback(fromIso: string, days: number): string {
  const d = new Date(fromIso);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return d.toISOString();
}

export async function ensureTerminationFinancialReviewTask(
  db: SupabaseClient,
  workspaceId: string,
  operationalTask: {
    id: string;
    task_type?: string;
    driver_id?: string | null;
    metadata?: unknown;
  },
  nextStatus: string
): Promise<string | null> {
  const taskType = String(operationalTask.task_type || '');
  if (!TERMINATION_SIGNATURE_TYPES.has(taskType)) return null;
  if (!isDriverSignedForSettlement(nextStatus)) return null;

  const meta =
    operationalTask.metadata && typeof operationalTask.metadata === 'object' && !Array.isArray(operationalTask.metadata)
      ? (operationalTask.metadata as Record<string, unknown>)
      : {};
  const requestId = String(meta.request_id || '').trim();
  const driverId = operationalTask.driver_id ? String(operationalTask.driver_id) : String(meta.driver_id || '');
  if (!requestId || !driverId) return null;

  const { data: existing } = await db
    .from('pending_tasks')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('task_type', 'driver_termination_financial_review')
    .filter('metadata->>request_id', 'eq', requestId)
    .in('status', ['open', 'in_progress'])
    .limit(1)
    .maybeSingle();
  if (existing?.id) return String(existing.id);

  const driverName = String(meta.driver_name || 'Entregador');
  const financeSectorId = await resolveFinanceSectorId(db, workspaceId);
  const financeAssigneeId = await resolveFinanceSectorAssigneeId(db, financeSectorId);
  const signedAt = new Date().toISOString();
  const settlementDays = Number(meta.settlement_business_days) || 7;
  const settlementDue = addBusinessDaysFallback(signedAt, settlementDays);

  const { data: inserted, error } = await db
    .from('pending_tasks')
    .insert({
      workspace_id: workspaceId,
      task_type: 'driver_termination_financial_review',
      title: `Acerto de desligamento: ${driverName}`,
      description: 'Verificar pendências, acertos e descontos após assinatura do termo de desligamento.',
      status: 'in_progress',
      priority: 'normal',
      driver_id: driverId,
      sector_id: financeSectorId,
      assignee_id: financeAssigneeId,
      source: String(meta.source || 'system'),
      due_at: settlementDue,
      metadata: {
        ...meta,
        operational_task_id: operationalTask.id,
        sector_action: 'financial_review',
        phase: 'awaiting_settlement',
        termination_signature_status: nextStatus,
        termination_signature_label: signatureStatusLabel(nextStatus),
        termination_signed_at: signedAt,
        settlement_due_at: settlementDue,
        settlement_business_days: settlementDays,
      },
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return inserted?.id ? String(inserted.id) : null;
}

export async function propagateTerminationSignatureToFinancialTasks(
  db: SupabaseClient,
  workspaceId: string,
  operationalTask: { id: string; task_type?: string; driver_id?: string | null; metadata?: unknown },
  nextStatus: string
): Promise<void> {
  await ensureTerminationFinancialReviewTask(db, workspaceId, operationalTask, nextStatus);

  const meta =
    operationalTask.metadata && typeof operationalTask.metadata === 'object' && !Array.isArray(operationalTask.metadata)
      ? (operationalTask.metadata as Record<string, unknown>)
      : {};
  const requestId = String(meta.request_id || '').trim();
  if (!requestId) return;

  const next = String(nextStatus || '').toLowerCase();
  const nowIso = new Date().toISOString();
  const settlementDays = Number(meta.settlement_business_days) || 7;

  const { data: finTasks, error } = await db
    .from('pending_tasks')
    .select('id, metadata, status, due_at')
    .eq('workspace_id', workspaceId)
    .eq('task_type', 'driver_termination_financial_review')
    .filter('metadata->>request_id', 'eq', requestId)
    .in('status', ['open', 'in_progress']);
  if (error) throw new Error(error.message);
  if (!finTasks?.length) return;

  for (const fin of finTasks) {
    const prevMeta =
      fin.metadata && typeof fin.metadata === 'object' && !Array.isArray(fin.metadata)
        ? (fin.metadata as Record<string, unknown>)
        : {};
    const patch: Record<string, unknown> = {
      ...prevMeta,
      operational_task_id: operationalTask.id,
      termination_signature_status: next,
      termination_signature_label: signatureStatusLabel(next),
    };
    let dueAt: string | null = fin.due_at ? String(fin.due_at) : null;
    let phase = String(prevMeta.phase || 'awaiting_signature');

    if (next === 'signed' || next === 'document_finished') {
      const signedAt = String(prevMeta.termination_signed_at || nowIso);
      const settlementDue = addBusinessDaysFallback(signedAt, settlementDays);
      patch.termination_signed_at = signedAt;
      patch.settlement_due_at = settlementDue;
      patch.settlement_business_days = settlementDays;
      patch.phase = 'awaiting_settlement';
      dueAt = settlementDue;
      phase = 'awaiting_settlement';
    } else if (next === 'rejected') {
      patch.phase = 'signature_rejected';
    } else if (next === 'awaiting_signature' || next === 'awaiting_view' || next === 'pending') {
      patch.phase = 'awaiting_signature';
    }

    await db
      .from('pending_tasks')
      .update({
        metadata: patch,
        due_at: dueAt,
        status: phase === 'awaiting_settlement' && fin.status === 'open' ? 'in_progress' : fin.status,
        updated_at: nowIso,
      })
      .eq('id', fin.id);
  }
}
