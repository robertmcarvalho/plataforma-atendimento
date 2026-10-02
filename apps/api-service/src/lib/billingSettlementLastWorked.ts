import { supabase } from './supabase';
import {
  dateOnly,
  pickLatestLastWorkedAt,
  TERMINATION_TASK_TYPES,
} from './billingSettlementOverlap';

type TaskRow = {
  driver_id?: string | null;
  status?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

function lastWorkedFromMetadata(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  return dateOnly(typeof metadata.last_worked_at === 'string' ? metadata.last_worked_at : null);
}

function taskPreferred(status: string | null | undefined): boolean {
  const s = String(status || '');
  return s === 'done' || s === 'in_progress';
}

/** last_worked_at de desligamento (solicitação/aprovação) por entregador. */
export async function loadApprovedOffboardingLastWorkedAt(
  workspaceId: string,
  driverIds?: string[]
): Promise<Map<string, string>> {
  const byDriver = new Map<string, Array<{ lastWorkedAt: string | null; createdAt: string; preferred: boolean }>>();

  let taskQuery = supabase
    .from('pending_tasks')
    .select('driver_id, status, created_at, completed_at, metadata')
    .eq('workspace_id', workspaceId)
    .in('task_type', [...TERMINATION_TASK_TYPES])
    .neq('status', 'cancelled');
  if (driverIds?.length) taskQuery = taskQuery.in('driver_id', driverIds);
  const { data: tasks, error: taskErr } = await taskQuery;
  if (taskErr) throw new Error(taskErr.message);

  for (const row of (tasks || []) as TaskRow[]) {
    const driverId = row.driver_id ? String(row.driver_id) : '';
    if (!driverId) continue;
    const lastWorkedAt = lastWorkedFromMetadata(row.metadata);
    if (!lastWorkedAt) continue;
    const list = byDriver.get(driverId) || [];
    list.push({
      lastWorkedAt,
      createdAt: String(row.completed_at || row.created_at || ''),
      preferred: taskPreferred(row.status),
    });
    byDriver.set(driverId, list);
  }

  let previewQuery = supabase
    .from('billing_driver_offboarding_previews')
    .select('driver_id, last_worked_at, status, created_at')
    .eq('workspace_id', workspaceId)
    .neq('status', 'cancelled');
  if (driverIds?.length) previewQuery = previewQuery.in('driver_id', driverIds);
  const { data: previews, error: previewErr } = await previewQuery;
  if (previewErr) throw new Error(previewErr.message);

  for (const row of previews || []) {
    const driverId = String(row.driver_id || '');
    if (!driverId) continue;
    const lastWorkedAt = dateOnly(row.last_worked_at ? String(row.last_worked_at) : null);
    if (!lastWorkedAt) continue;
    const list = byDriver.get(driverId) || [];
    list.push({
      lastWorkedAt,
      createdAt: String(row.created_at || ''),
      preferred: true,
    });
    byDriver.set(driverId, list);
  }

  const out = new Map<string, string>();
  for (const [driverId, candidates] of byDriver) {
    const picked = pickLatestLastWorkedAt(candidates);
    if (picked) out.set(driverId, picked);
  }
  return out;
}

export async function loadDriverOperationalLastWorkedAt(
  workspaceId: string,
  driverId: string
): Promise<string | null> {
  const map = await loadApprovedOffboardingLastWorkedAt(workspaceId, [driverId]);
  return map.get(driverId) || null;
}
