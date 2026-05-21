import type { SupabaseClient } from '@supabase/supabase-js';

type JsonRecord = Record<string, unknown>;

type SlaCfg = {
  sla_minutes: number;
  warning_pct: number;
  reminder_minutes: number;
  escalate_after_x: number;
  supervisor_role: string;
  fallback_admin_role: string;
};

const DEFAULT_SLA: SlaCfg = {
  sla_minutes: 120,
  warning_pct: 0.8,
  reminder_minutes: 30,
  escalate_after_x: 2,
  supervisor_role: 'supervisor',
  fallback_admin_role: 'admin',
};

function asMeta(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonRecord;
}

async function loadSla(db: SupabaseClient): Promise<SlaCfg> {
  const { data } = await db.from('app_settings').select('value').eq('key', 'sla_advance_request').maybeSingle();
  const v = asMeta(data?.value);
  const sla = Number(v.sla_minutes);
  const warning = Number(v.warning_pct);
  const reminder = Number(v.reminder_minutes);
  const esc = Number(v.escalate_after_x);
  return {
    sla_minutes: sla > 0 ? sla : DEFAULT_SLA.sla_minutes,
    warning_pct: warning > 0 && warning < 1 ? warning : DEFAULT_SLA.warning_pct,
    reminder_minutes: reminder > 0 ? reminder : DEFAULT_SLA.reminder_minutes,
    escalate_after_x: esc > 0 ? esc : DEFAULT_SLA.escalate_after_x,
    supervisor_role:
      typeof v.supervisor_role === 'string' && v.supervisor_role.trim() ? v.supervisor_role.trim() : DEFAULT_SLA.supervisor_role,
    fallback_admin_role:
      typeof v.fallback_admin_role === 'string' && v.fallback_admin_role.trim()
        ? v.fallback_admin_role.trim()
        : DEFAULT_SLA.fallback_admin_role,
  };
}

export function registerAdvanceTasksSlaJobs(db: SupabaseClient, timezone: string) {
  return {
    timezone,
    runAdvanceSlaJob: () => runAdvanceSlaJob(db),
  };
}

async function runAdvanceSlaJob(db: SupabaseClient) {
  const cfg = await loadSla(db);
  const now = Date.now();
  const { data: rows, error } = await db
    .from('pending_tasks')
    .select('id, task_type, title, status, due_at, created_at, assignee_id, conversation_id, metadata')
    .eq('task_type', 'financial_advance_request')
    .in('status', ['open', 'in_progress']);
  if (error || !rows?.length) return;

  for (const row of rows) {
    const dueAtMs = new Date(String(row.due_at || '')).getTime();
    const createdAtMs = new Date(String(row.created_at || '')).getTime();
    if (Number.isNaN(dueAtMs) || Number.isNaN(createdAtMs)) continue;
    const meta = asMeta(row.metadata);
    const warningAt = dueAtMs - (1 - cfg.warning_pct) * cfg.sla_minutes * 60 * 1000;
    const overdueAt = dueAtMs;
    const escalateAt = createdAtMs + cfg.escalate_after_x * cfg.sla_minutes * 60 * 1000;

    if (now >= warningAt && meta.notified_80 !== true) {
      await createDerivedNotification(db, row, 'advance_sla_warning', 'high', 'Alerta 80% SLA adiantamento');
      await updateTaskMeta(db, String(row.id), { ...meta, notified_80: true });
      await logSlaAudit(db, 'sla.advance_warning', row, cfg);
      await appendSlaInternalNote(db, row, 'Alerta preventivo: pendência de adiantamento atingiu 80% do SLA.');
    }

    if (now >= overdueAt && meta.notified_overdue !== true) {
      await createDerivedNotification(db, row, 'advance_sla_overdue', 'urgent', 'SLA vencido adiantamento');
      await updateTaskMeta(db, String(row.id), { ...meta, notified_overdue: true });
      await logSlaAudit(db, 'sla.advance_overdue', row, cfg);
      await appendSlaInternalNote(db, row, 'SLA vencido para decisão de adiantamento.');
    }

    if (now >= overdueAt) {
      const recentSince = new Date(now - cfg.reminder_minutes * 60 * 1000).toISOString();
      const { data: recentReminder } = await db
        .from('pending_tasks')
        .select('id')
        .eq('task_type', 'advance_sla_reminder')
        .in('status', ['open', 'in_progress'])
        .gte('created_at', recentSince)
        .contains('metadata', { parent_task_id: row.id } as JsonRecord)
        .limit(1)
        .maybeSingle();
      if (!recentReminder?.id) {
        await createDerivedNotification(db, row, 'advance_sla_reminder', 'urgent', 'Lembrete SLA adiantamento');
      }
    }

    if (now >= escalateAt && meta.escalated !== true) {
      const adminId = await resolveActiveUserByRole(db, cfg.fallback_admin_role);
      if (adminId) {
        await db.from('pending_tasks').update({ assignee_id: adminId, updated_at: new Date().toISOString() }).eq('id', row.id);
        await updateTaskMeta(db, String(row.id), { ...meta, escalated: true });
        await logSlaAudit(db, 'sla.advance_escalated', row, cfg, { to_assignee_id: adminId });
        await appendSlaInternalNote(db, row, 'Pendência escalonada automaticamente para administração por extrapolar o SLA.');
      }
    }
  }

  await cancelOrphanDerivedNotifications(db);
}

async function cancelOrphanDerivedNotifications(db: SupabaseClient) {
  const { data: mainDone } = await db
    .from('pending_tasks')
    .select('id')
    .eq('task_type', 'financial_advance_request')
    .in('status', ['done', 'cancelled']);
  const ids = (mainDone || []).map((x) => String(x.id));
  if (!ids.length) return;
  const { data: derived } = await db
    .from('pending_tasks')
    .select('id, metadata')
    .in('task_type', ['advance_sla_warning', 'advance_sla_overdue', 'advance_sla_reminder'])
    .in('status', ['open', 'in_progress']);
  const toCancel = (derived || [])
    .filter((row) => ids.includes(String(asMeta(row.metadata).parent_task_id || '')))
    .map((row) => String(row.id));
  if (!toCancel.length) return;
  await db
    .from('pending_tasks')
    .update({ status: 'cancelled', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .in('id', toCancel);
}

async function createDerivedNotification(
  db: SupabaseClient,
  parent: { id: string; assignee_id?: string | null; conversation_id?: string | null; title?: string | null },
  taskType: 'advance_sla_warning' | 'advance_sla_overdue' | 'advance_sla_reminder',
  priority: 'high' | 'urgent',
  title: string
) {
  const assignee = parent.assignee_id || null;
  if (!assignee) return;
  await db.from('pending_tasks').insert({
    task_type: taskType,
    title,
    description: `Pendência #${String(parent.id).slice(0, 8)}: ${(parent.title || 'Solicitação de adiantamento').toString()}`,
    status: 'open',
    priority,
    conversation_id: parent.conversation_id || null,
    assignee_id: assignee,
    source: 'system',
    metadata: { parent_task_id: parent.id },
    due_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });
}

async function updateTaskMeta(db: SupabaseClient, taskId: string, metadata: JsonRecord) {
  await db.from('pending_tasks').update({ metadata, updated_at: new Date().toISOString() }).eq('id', taskId);
}

async function resolveActiveUserByRole(db: SupabaseClient, role: string): Promise<string | null> {
  const { data } = await db.from('users').select('id').eq('role', role).eq('is_active', true).limit(1).maybeSingle();
  return (data?.id as string | undefined) || null;
}

async function logSlaAudit(
  db: SupabaseClient,
  action: 'sla.advance_warning' | 'sla.advance_overdue' | 'sla.advance_escalated',
  task: { id: string },
  cfg: SlaCfg,
  extra: JsonRecord = {}
) {
  await db.from('audit_logs').insert({
    actor_id: null,
    action,
    entity_type: 'pending_task',
    entity_id: task.id,
    metadata: {
      task_id: task.id,
      sla_minutes: cfg.sla_minutes,
      warning_pct: cfg.warning_pct,
      reminder_minutes: cfg.reminder_minutes,
      escalate_after_x: cfg.escalate_after_x,
      ...extra,
    },
  });
}

async function appendSlaInternalNote(
  db: SupabaseClient,
  task: { conversation_id?: string | null; id: string },
  message: string
) {
  const conversationId = task.conversation_id || null;
  if (!conversationId) return;
  const { data: systemAuthor } = await db.from('users').select('id').eq('is_active', true).limit(1).maybeSingle();
  const authorId = (systemAuthor?.id as string | undefined) || null;
  if (!authorId) return;
  await db.from('internal_notes').insert({
    conversation_id: conversationId,
    author_id: authorId,
    content: `[SLA Adiantamento] ${message} (task: ${String(task.id).slice(0, 8)})`,
  });
}
