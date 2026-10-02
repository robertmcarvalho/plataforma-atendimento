import type { SupabaseClient } from '@supabase/supabase-js';
import { signatureStatusLabel } from '@plataforma/operational-notes';

function isDriverSignedForSettlement(status: string): boolean {
  const s = String(status || '').toLowerCase().trim();
  return s === 'signed' || s === 'document_finished';
}
import { addBusinessDays, normalizeBusinessHours } from './businessHours';
import {
  catalogEntryByType,
  formatTaskTitle,
  isTaskTypeCreatableForWorkspace,
  loadOpsTaskCatalog,
} from './opsTaskCatalog';
import { loadOpsTaskPlaybooks, loadOpsTaskSlaConfig, resolveTaskPlaybook } from './opsTaskConfig';

const TERMINATION_SIGNATURE_TYPES = new Set(['driver_termination_prep', 'driver_termination_request']);

function playbookChecklist(
  taskType: string,
  playbooksConfig: Awaited<ReturnType<typeof loadOpsTaskPlaybooks>>
) {
  const pb = resolveTaskPlaybook(taskType, playbooksConfig);
  return pb.steps.map((s) => ({ id: s.id, label: s.label, done: Boolean(s.done) }));
}

export async function resolveFinanceSectorId(
  db: SupabaseClient,
  workspaceId: string
): Promise<string | null> {
  const { data } = await db
    .from('sectors')
    .select('id')
    .eq('workspace_id', workspaceId)
    .ilike('name', 'Financeiro')
    .limit(1)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

export async function resolveFinanceSectorBusinessHours(
  db: SupabaseClient,
  workspaceId: string
): Promise<ReturnType<typeof normalizeBusinessHours> | null> {
  const { data: sector } = await db
    .from('sectors')
    .select('business_hours')
    .eq('workspace_id', workspaceId)
    .ilike('name', 'Financeiro')
    .limit(1)
    .maybeSingle();
  if (!sector?.business_hours) return null;
  return normalizeBusinessHours(sector.business_hours);
}

/** Primeiro atendente ativo vinculado ao setor Financeiro (para assignee da tarefa de acerto). */
export async function resolveFinanceSectorAssigneeId(
  db: SupabaseClient,
  workspaceId: string,
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
  const { data: queueUsers } = await db
    .from('queue_assignments')
    .select('user_id, users!inner(id, is_active)')
    .eq('workspace_id', workspaceId)
    .eq('sector_id', financeSectorId)
    .limit(20);
  for (const row of queueUsers || []) {
    const u = row.users as { id?: string; is_active?: boolean } | { id?: string; is_active?: boolean }[];
    const user = Array.isArray(u) ? u[0] : u;
    if (user?.is_active !== false && user?.id) return String(user.id);
  }
  return null;
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

  const meta =
    operationalTask.metadata && typeof operationalTask.metadata === 'object' && !Array.isArray(operationalTask.metadata)
      ? (operationalTask.metadata as Record<string, unknown>)
      : {};
  const requestId = String(meta.request_id || '').trim();
  const driverId = operationalTask.driver_id ? String(operationalTask.driver_id) : String(meta.driver_id || '');
  if (!requestId || !driverId) return null;

  const next = String(nextStatus || '').toLowerCase();
  const driverSigned = isDriverSignedForSettlement(next);

  let findQuery = db
    .from('pending_tasks')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('task_type', 'driver_termination_financial_review')
    .in('status', ['open', 'in_progress'])
    .limit(1);
  findQuery = findQuery.filter('metadata->>request_id', 'eq', requestId);
  const { data: existing } = await findQuery.maybeSingle();
  if (existing?.id) return String(existing.id);

  if (!driverSigned) return null;

  const allowed = await isTaskTypeCreatableForWorkspace(
    db,
    workspaceId,
    'driver_termination_financial_review',
    'leader_termination'
  );
  if (!allowed) return null;

  const [catalog, playbooksConfig, slaConfig] = await Promise.all([
    loadOpsTaskCatalog(db, workspaceId),
    loadOpsTaskPlaybooks(db, workspaceId),
    loadOpsTaskSlaConfig(db, workspaceId),
  ]);
  const finEntry = catalogEntryByType(catalog, 'driver_termination_financial_review');
  const driverName = String(meta.driver_name || 'Entregador');
  const financeSectorId = await resolveFinanceSectorId(db, workspaceId);
  const financeAssigneeId = await resolveFinanceSectorAssigneeId(db, workspaceId, financeSectorId);
  const settlementDays = slaConfig.driver_termination_financial_review?.settlement_business_days ?? 7;
  const financeBh = await resolveFinanceSectorBusinessHours(db, workspaceId);
  const signedAt = new Date().toISOString();
  const settlementDue = addBusinessDays(financeBh, new Date(signedAt), settlementDays);

  const finMeta: Record<string, unknown> = {
    ...meta,
    operational_task_id: operationalTask.id,
    sector_action: 'financial_review',
    phase: 'awaiting_settlement',
    termination_signature_status: next,
    termination_signature_label: signatureStatusLabel(next),
    termination_signed_at: signedAt,
    settlement_due_at: settlementDue.toISOString(),
    settlement_business_days: settlementDays,
    playbook_progress: playbookChecklist('driver_termination_financial_review', playbooksConfig),
  };

  const { data: inserted, error } = await db
    .from('pending_tasks')
    .insert({
      workspace_id: workspaceId,
      task_type: 'driver_termination_financial_review',
      title: formatTaskTitle(finEntry?.title_template || 'Acerto de desligamento: {driver_name}', {
        driver_name: driverName,
      }),
      description: 'Verificar pendências, acertos e descontos após assinatura do termo de desligamento.',
      status: 'in_progress',
      priority: 'normal',
      driver_id: driverId,
      sector_id: financeSectorId,
      assignee_id: financeAssigneeId,
      source: String(meta.source || 'system'),
      due_at: settlementDue.toISOString(),
      metadata: finMeta,
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
  const taskType = String(operationalTask.task_type || '');
  if (!TERMINATION_SIGNATURE_TYPES.has(taskType)) return;

  await ensureTerminationFinancialReviewTask(db, workspaceId, operationalTask, nextStatus);

  const meta =
    operationalTask.metadata && typeof operationalTask.metadata === 'object' && !Array.isArray(operationalTask.metadata)
      ? (operationalTask.metadata as Record<string, unknown>)
      : {};
  const requestId = String(meta.request_id || '').trim();
  if (!requestId) return;

  const next = String(nextStatus || '').toLowerCase();
  const nowIso = new Date().toISOString();

  const { data: finTasks, error } = await db
    .from('pending_tasks')
    .select('id, metadata, status, due_at')
    .eq('workspace_id', workspaceId)
    .eq('task_type', 'driver_termination_financial_review')
    .filter('metadata->>request_id', 'eq', requestId)
    .in('status', ['open', 'in_progress']);
  if (error) throw new Error(error.message);
  if (!finTasks?.length) return;

  const slaConfig = await loadOpsTaskSlaConfig(db, workspaceId);
  const settlementDays =
    slaConfig.driver_termination_financial_review?.settlement_business_days ?? 7;
  const financeBh = await resolveFinanceSectorBusinessHours(db, workspaceId);

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
      const settlementDue = addBusinessDays(financeBh, new Date(signedAt), settlementDays);
      patch.termination_signed_at = signedAt;
      patch.settlement_due_at = settlementDue.toISOString();
      patch.settlement_business_days = settlementDays;
      patch.phase = 'awaiting_settlement';
      dueAt = settlementDue.toISOString();
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
