import type { SupabaseClient } from '@supabase/supabase-js';
import { isSignaturePendingStatus, SIGNATURE_TRACKED_TASK_TYPES } from '@plataforma/operational-notes';

const OPS_TASK_SLA_CONFIG_KEY = 'ops_task_sla_config';

type SlaEntry = { signature_deadline_days?: number };

async function signatureDeadlineDays(
  db: SupabaseClient,
  workspaceId: string,
  taskType: string
): Promise<number> {
  const defaults: Record<string, number> = {
    driver_enrollment_prep: 5,
    driver_termination_prep: 5,
    driver_termination_request: 5,
  };
  const { data } = await db
    .from('app_settings')
    .select('value')
    .eq('workspace_id', workspaceId)
    .eq('key', OPS_TASK_SLA_CONFIG_KEY)
    .maybeSingle();
  const stored = (data?.value || {}) as Record<string, SlaEntry>;
  return stored[taskType]?.signature_deadline_days ?? defaults[taskType] ?? 5;
}

export function registerSignatureDeadlineJobs(db: SupabaseClient, timezone: string) {
  return {
    timezone,
    runSignatureDeadlineJob: () => runSignatureDeadlineJob(db),
  };
}

async function runSignatureDeadlineJob(db: SupabaseClient) {
  const { data: workspaces, error } = await db.from('workspaces').select('id');
  if (error) throw error;
  if (!workspaces?.length) return { notified: 0 };

  const now = Date.now();
  let notified = 0;

  for (const ws of workspaces) {
    const workspaceId = String(ws.id);
    const { data: tasks, error: taskErr } = await db
      .from('pending_tasks')
      .select('id, task_type, title, assignee_id, driver_id, metadata, created_at, driver:drivers(name)')
      .eq('workspace_id', workspaceId)
      .in('task_type', [...SIGNATURE_TRACKED_TASK_TYPES])
      .in('status', ['open', 'in_progress']);
    if (taskErr) throw taskErr;

    for (const task of tasks || []) {
      const meta = (task.metadata || {}) as Record<string, unknown>;
      const status = meta.signature_status != null ? String(meta.signature_status) : 'awaiting_document';
      if (!isSignaturePendingStatus(status)) continue;

      const deadlineDays = await signatureDeadlineDays(db, workspaceId, String(task.task_type));
      const createdAt = task.created_at ? new Date(String(task.created_at)).getTime() : now;
      const daysPending = Math.floor((now - createdAt) / 86400000);
      if (daysPending < deadlineDays) continue;

      const driver = task.driver as { name?: string } | { name?: string }[] | null;
      const driverRow = Array.isArray(driver) ? driver[0] : driver;
      const driverName = driverRow?.name ? String(driverRow.name) : String(task.title || 'Entregador');

      // Prazo estourado aparece no painel `signature_pending` (dias > prazo) — sem pending_task.
      notified += 1;
    }
  }

  return { notified };
}
