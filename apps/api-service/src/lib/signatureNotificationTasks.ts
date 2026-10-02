import type { SupabaseClient } from '@supabase/supabase-js';
import { propagateTerminationSignatureToFinancialTasks } from './terminationFinancialSync';

export type SignatureNotifEvent =
  | 'driver_signature_pending'
  | 'driver_signature_viewed'
  | 'driver_signature_signed'
  | 'driver_signature_rejected'
  | 'driver_signature_overdue';

/** Encerra tarefas legadas `driver_signature_notification` (não devem mais ser criadas). */
export async function cancelSignatureNotifications(
  db: SupabaseClient,
  workspaceId: string,
  parentTaskId: string,
  exceptEvents?: SignatureNotifEvent[]
) {
  const { data } = await db
    .from('pending_tasks')
    .select('id, metadata')
    .eq('workspace_id', workspaceId)
    .eq('task_type', 'driver_signature_notification')
    .in('status', ['open', 'in_progress'])
    .filter('metadata->>parent_task_id', 'eq', parentTaskId);

  const ids = (data || [])
    .filter((row) => {
      const ev = String((row.metadata as Record<string, unknown>)?.signature_event || '');
      if (exceptEvents?.includes(ev as SignatureNotifEvent)) return false;
      return true;
    })
    .map((r) => String(r.id));

  if (!ids.length) return;
  await db
    .from('pending_tasks')
    .update({ status: 'cancelled', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .in('id', ids);
}

/** Assinaturas aparecem em `signature_pending` do hub — não criar pending_tasks. */
export async function createSignatureNotificationIfNeeded(
  _db: SupabaseClient,
  _args: {
    workspaceId: string;
    parentTaskId: string;
    driverId: string;
    driverName: string;
    assigneeId: string | null;
    event: SignatureNotifEvent;
    description?: string;
  }
): Promise<void> {
  return;
}

export async function handleSignatureStatusTransition(
  db: SupabaseClient,
  args: {
    workspaceId: string;
    taskId: string;
    driverId: string;
    driverName: string;
    assigneeId: string | null;
    prevStatus: string | null;
    nextStatus: string;
  }
) {
  const { workspaceId, taskId, prevStatus, nextStatus } = args;
  const prev = String(prevStatus || '').toLowerCase();
  const next = String(nextStatus || '').toLowerCase();
  if (prev === next) return;

  const { data: parentTask } = await db
    .from('pending_tasks')
    .select('id, task_type, metadata')
    .eq('workspace_id', workspaceId)
    .eq('id', taskId)
    .maybeSingle();
  if (parentTask) {
    await propagateTerminationSignatureToFinancialTasks(db, workspaceId, parentTask, next);
  }

  await cancelSignatureNotifications(db, workspaceId, taskId);
}
