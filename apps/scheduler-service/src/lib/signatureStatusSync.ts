import type { SupabaseClient } from '@supabase/supabase-js';
import {
  runSignatureSyncForWorkspaceCore,
  type SignatureTransitionContext,
} from '@plataforma/operational-notes';
import { propagateTerminationSignatureToFinancialTasks } from './terminationFinancialSync';

async function cancelLegacySignatureNotificationTasks(
  db: SupabaseClient,
  workspaceId: string,
  parentTaskId: string
) {
  const { data } = await db
    .from('pending_tasks')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('task_type', 'driver_signature_notification')
    .in('status', ['open', 'in_progress'])
    .filter('metadata->>parent_task_id', 'eq', parentTaskId);
  const ids = (data || []).map((r) => String(r.id));
  if (!ids.length) return;
  await db
    .from('pending_tasks')
    .update({ status: 'cancelled', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .in('id', ids);
}

async function onSchedulerSignatureTransition(
  db: SupabaseClient,
  ctx: SignatureTransitionContext
): Promise<void> {
  const prev = String(ctx.prevStatus || '').toLowerCase();
  const next = String(ctx.nextStatus || '').toLowerCase();
  if (prev === next) return;

  const { data: parentTask } = await db
    .from('pending_tasks')
    .select('id, task_type, driver_id, metadata')
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', ctx.taskId)
    .maybeSingle();
  if (parentTask) {
    await propagateTerminationSignatureToFinancialTasks(db, ctx.workspaceId, parentTask, next);
  }

  await cancelLegacySignatureNotificationTasks(db, ctx.workspaceId, ctx.taskId);
}

export async function runSignatureSyncForWorkspace(db: SupabaseClient, workspaceId: string) {
  return runSignatureSyncForWorkspaceCore(db, workspaceId, (ctx) =>
    onSchedulerSignatureTransition(db, ctx)
  );
}
