import type { SupabaseClient } from '@supabase/supabase-js';
import {
  formatQueueSlaEscalationNote,
  formatQueueSlaOverdueNote,
  formatQueueSlaReassignNote,
  formatQueueSlaWarningNote,
} from '@plataforma/operational-notes';

type JsonRecord = Record<string, unknown>;

function asMeta(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonRecord;
}

export function registerQueueSlaJobs(db: SupabaseClient, timezone: string) {
  return {
    timezone,
    runQueueSlaJob: () => runQueueSlaJob(db),
  };
}

async function runQueueSlaJob(db: SupabaseClient) {
  const now = Date.now();
  const { data: rows, error } = await db
    .from('pending_tasks')
    .select('id, task_type, title, status, due_at, created_at, assignee_id, conversation_id, metadata')
    .eq('task_type', 'queue_sla_treatment')
    .in('status', ['open', 'in_progress']);
  if (error || !rows?.length) return;

  for (const row of rows) {
    const conversationId = String(row.conversation_id || '');
    if (!conversationId) continue;

    const { data: conv } = await db
      .from('conversations')
      .select('id, status, attendant_id, sector_id')
      .eq('id', conversationId)
      .maybeSingle();
    if (!conv?.id) continue;

    if (['resolved', 'closed'].includes(String(conv.status || ''))) {
      await closeQueueTask(db, String(row.id), 'cancelled');
      await db
        .from('pending_tasks')
        .update({
          status: 'done',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('conversation_id', conversationId)
        .eq('task_type', 'guided_demand')
        .in('status', ['open', 'in_progress']);
      continue;
    }

    const dueAtMs = new Date(String(row.due_at || '')).getTime();
    if (Number.isNaN(dueAtMs)) continue;
    const meta = asMeta(row.metadata);
    const treatmentMinutes = Number(meta.treatment_minutes || 120);
    const warningAt = dueAtMs - treatmentMinutes * 0.2 * 60 * 1000;
    const overdueAt = dueAtMs;
    const treatmentAction = String(meta.action || 'alert_and_reassign');

    if (now >= warningAt && meta.notified_80 !== true) {
      const assigneeId = await resolveNotificationAssignee(db, conv.attendant_id as string | null | undefined);
      if (assigneeId) {
        await createDerivedNotification(
          db,
          row,
          assigneeId,
          'queue_sla_treatment_warning',
          'high',
          'SLA tratamento em 80%'
        );
      }
      await updateTaskMeta(db, String(row.id), { ...meta, notified_80: true });
      await appendInternalNote(db, conversationId, formatQueueSlaWarningNote());
      await writeAuditLogCompat(db, 'sla.queue_treatment_warning', 'pending_task', String(row.id), {
        conversation_id: conversationId,
        treatment_action: treatmentAction,
      });
    }

    if (now >= overdueAt && meta.notified_overdue !== true) {
      const assigneeId = await resolveNotificationAssignee(db, conv.attendant_id as string | null | undefined);
      if (assigneeId) {
        await createDerivedNotification(
          db,
          row,
          assigneeId,
          'queue_sla_treatment_overdue',
          'urgent',
          'SLA tratamento vencido'
        );
      }
      await updateTaskMeta(db, String(row.id), { ...meta, notified_overdue: true });
      await appendInternalNote(db, conversationId, formatQueueSlaOverdueNote());
      await writeAuditLogCompat(db, 'sla.queue_treatment_overdue', 'pending_task', String(row.id), {
        conversation_id: conversationId,
        treatment_action: treatmentAction,
      });
    }

    if (now < overdueAt) continue;

    if (treatmentAction === 'alert_and_reassign' && meta.reassigned !== true) {
      const supervisorId = await resolveSupervisorId(db, conv.attendant_id as string | null | undefined);
      await db
        .from('conversations')
        .update({
          attendant_id: supervisorId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId);
      await updateTaskMeta(db, String(row.id), { ...meta, reassigned: true, notified_overdue: true });
      await appendInternalNote(db, conversationId, formatQueueSlaReassignNote(Boolean(supervisorId)));
      await writeAuditLogCompat(db, 'sla.queue_treatment_reassigned', 'conversation', conversationId, {
        task_id: row.id,
        to_assignee_id: supervisorId,
      });
      continue;
    }

    if (treatmentAction === 'escalate_supervisor' && meta.escalated !== true) {
      const supervisorId = await resolveSupervisorId(db, conv.attendant_id as string | null | undefined);
      const supervisionSectorId = await resolveSectorIdByName(db, 'Supervisão');
      const updates: JsonRecord = {
        updated_at: new Date().toISOString(),
      };
      if (supervisorId) updates.attendant_id = supervisorId;
      if (supervisionSectorId) updates.sector_id = supervisionSectorId;
      await db.from('conversations').update(updates).eq('id', conversationId);
      await updateTaskMeta(db, String(row.id), { ...meta, escalated: true, notified_overdue: true });
      await appendInternalNote(db, conversationId, formatQueueSlaEscalationNote());
      await writeAuditLogCompat(db, 'sla.queue_treatment_escalated', 'conversation', conversationId, {
        task_id: row.id,
        to_assignee_id: supervisorId,
        to_sector_id: supervisionSectorId,
      });
    }
  }

  await cancelOrphanDerivedNotifications(db);
}

async function closeQueueTask(db: SupabaseClient, taskId: string, status: 'cancelled' | 'done') {
  await db
    .from('pending_tasks')
    .update({ status, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', taskId);
}

async function resolveSectorIdByName(db: SupabaseClient, name: string): Promise<string | null> {
  const { data } = await db.from('sectors').select('id').eq('name', name).maybeSingle();
  return (data?.id as string | undefined) || null;
}

async function resolveSupervisorId(db: SupabaseClient, fallbackUserId?: string | null): Promise<string | null> {
  const { data } = await db
    .from('users')
    .select('id')
    .eq('role', 'supervisor')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) || fallbackUserId || null;
}

async function resolveNotificationAssignee(db: SupabaseClient, attendantId?: string | null): Promise<string | null> {
  if (attendantId) return attendantId;
  return resolveSupervisorId(db, null);
}

async function createDerivedNotification(
  db: SupabaseClient,
  parent: { id: string; conversation_id?: string | null; title?: string | null },
  assigneeId: string,
  taskType: 'queue_sla_treatment_warning' | 'queue_sla_treatment_overdue',
  priority: 'high' | 'urgent',
  title: string
) {
  const { data: existing } = await db
    .from('pending_tasks')
    .select('id')
    .eq('task_type', taskType)
    .eq('assignee_id', assigneeId)
    .in('status', ['open', 'in_progress'])
    .contains('metadata', { parent_task_id: parent.id } as JsonRecord)
    .limit(1)
    .maybeSingle();
  if (existing?.id) return;

  await db.from('pending_tasks').insert({
    task_type: taskType,
    title,
    description: `Queue SLA #${String(parent.id).slice(0, 8)}: ${(parent.title || 'Tratamento').toString()}`,
    status: 'open',
    priority,
    conversation_id: parent.conversation_id || null,
    assignee_id: assigneeId,
    source: 'system',
    metadata: { parent_task_id: parent.id },
    due_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  });
}

async function updateTaskMeta(db: SupabaseClient, taskId: string, metadata: JsonRecord) {
  await db.from('pending_tasks').update({ metadata, updated_at: new Date().toISOString() }).eq('id', taskId);
}

async function cancelOrphanDerivedNotifications(db: SupabaseClient) {
  const { data: mainDone } = await db
    .from('pending_tasks')
    .select('id')
    .eq('task_type', 'queue_sla_treatment')
    .in('status', ['done', 'cancelled']);
  const ids = (mainDone || []).map((x) => String(x.id));
  if (!ids.length) return;

  const { data: derived } = await db
    .from('pending_tasks')
    .select('id, metadata')
    .in('task_type', ['queue_sla_treatment_warning', 'queue_sla_treatment_overdue'])
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

async function appendInternalNote(db: SupabaseClient, conversationId: string, content: string) {
  const { data: systemAuthor } = await db.from('users').select('id').eq('is_active', true).limit(1).maybeSingle();
  const authorId = (systemAuthor?.id as string | undefined) || null;
  if (!authorId) return;
  await db.from('internal_notes').insert({
    conversation_id: conversationId,
    author_id: authorId,
    content,
  });
}

async function writeAuditLogCompat(
  db: SupabaseClient,
  action: string,
  entityType: string,
  entityId: string,
  metadata: JsonRecord
) {
  const { error: errNew } = await db.from('audit_logs').insert({
    actor_id: null,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata,
  });
  if (!errNew) return;

  const { error: errLegacy } = await db.from('audit_logs').insert({
    user_id: null,
    entity_type: entityType,
    entity_id: entityId,
    action,
    old_data: null,
    new_data: metadata,
    ip_address: 'scheduler',
  });
  if (errLegacy) {
    console.warn('[queue_sla.audit]', errLegacy.message);
  }
}
