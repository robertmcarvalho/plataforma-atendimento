import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resolveLeastOpenAssigneeInSector,
  resolveSectorIdByName,
  TASK_SECTOR_NAMES,
} from './taskAssignment';

const OPEN_TASK_STATUSES = ['open', 'in_progress'] as const;

const TERMINATION_TASK_TYPES = ['driver_termination_request', 'driver_termination_prep'] as const;

export type AssignStrategy = 'least_open' | 'fixed' | 'none';

export type DedupeKey =
  | { kind: 'driver_task_type' }
  | { kind: 'termination' }
  | { kind: 'pre_registration' }
  | { kind: 'conversation'; conversation_id: string }
  | { kind: 'none' };

export type PendingTaskInsert = {
  workspace_id: string;
  task_type: string;
  title: string;
  description?: string | null;
  status?: string;
  priority?: string;
  driver_id?: string | null;
  assignee_id?: string | null;
  sector_id?: string | null;
  sector_name?: string;
  assign_strategy?: AssignStrategy;
  source?: string;
  due_at?: string | null;
  metadata?: Record<string, unknown>;
  conversation_id?: string | null;
};

export async function hasOpenDriverTask(
  db: SupabaseClient,
  workspaceId: string,
  driverId: string,
  taskType: string,
): Promise<boolean> {
  const { data } = await db
    .from('pending_tasks')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('driver_id', driverId)
    .eq('task_type', taskType)
    .in('status', [...OPEN_TASK_STATUSES])
    .limit(1)
    .maybeSingle();
  return Boolean(data?.id);
}

export async function hasOpenTerminationTask(
  db: SupabaseClient,
  workspaceId: string,
  driverId: string,
): Promise<boolean> {
  const { data } = await db
    .from('pending_tasks')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('driver_id', driverId)
    .in('task_type', [...TERMINATION_TASK_TYPES])
    .in('status', [...OPEN_TASK_STATUSES])
    .limit(1)
    .maybeSingle();
  return Boolean(data?.id);
}

export async function hasOpenPreRegistrationTask(
  db: SupabaseClient,
  workspaceId: string,
  driverId: string,
): Promise<boolean> {
  const types = ['driver_pre_registration', 'driver_registration_completion', 'driver_enrollment_prep'];
  const { data } = await db
    .from('pending_tasks')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('driver_id', driverId)
    .in('task_type', types)
    .in('status', [...OPEN_TASK_STATUSES])
    .limit(1)
    .maybeSingle();
  return Boolean(data?.id);
}

async function hasOpenConversationTask(
  db: SupabaseClient,
  workspaceId: string,
  taskType: string,
  conversationId: string,
): Promise<boolean> {
  const { data } = await db
    .from('pending_tasks')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('task_type', taskType)
    .eq('conversation_id', conversationId)
    .in('status', [...OPEN_TASK_STATUSES])
    .limit(1)
    .maybeSingle();
  return Boolean(data?.id);
}

export async function shouldSkipDuplicateTask(
  db: SupabaseClient,
  workspaceId: string,
  taskType: string,
  driverId: string | null | undefined,
  dedupe: DedupeKey,
): Promise<boolean> {
  switch (dedupe.kind) {
    case 'none':
      return false;
    case 'driver_task_type':
      return driverId ? hasOpenDriverTask(db, workspaceId, driverId, taskType) : false;
    case 'termination':
      return driverId ? hasOpenTerminationTask(db, workspaceId, driverId) : false;
    case 'pre_registration':
      return driverId ? hasOpenPreRegistrationTask(db, workspaceId, driverId) : false;
    case 'conversation':
      return hasOpenConversationTask(db, workspaceId, taskType, dedupe.conversation_id);
    default:
      return false;
  }
}

export async function resolveTaskAssignee(
  db: SupabaseClient,
  workspaceId: string,
  input: {
    strategy?: AssignStrategy;
    assignee_id?: string | null;
    sector_name?: string;
    sector_id?: string | null;
  },
): Promise<{ assigneeId: string | null; sectorId: string | null }> {
  const strategy = input.strategy || 'none';
  if (strategy === 'least_open' && input.sector_name) {
    return resolveLeastOpenAssigneeInSector(db, workspaceId, input.sector_name);
  }
  const sectorId =
    input.sector_id ??
    (input.sector_name ? await resolveSectorIdByName(db, workspaceId, input.sector_name) : null);
  if (strategy === 'fixed') {
    return { assigneeId: input.assignee_id || null, sectorId };
  }
  return { assigneeId: input.assignee_id || null, sectorId };
}

/** Cria tarefa com atribuição automática e dedupe centralizado. Retorna null se duplicata. */
export async function insertPendingTask(
  db: SupabaseClient,
  input: PendingTaskInsert,
  dedupe: DedupeKey = { kind: 'driver_task_type' },
): Promise<Record<string, unknown> | null> {
  if (await shouldSkipDuplicateTask(db, input.workspace_id, input.task_type, input.driver_id, dedupe)) {
    return null;
  }

  const { assigneeId, sectorId } = await resolveTaskAssignee(db, input.workspace_id, {
    strategy: input.assign_strategy || (input.sector_name ? 'least_open' : 'none'),
    assignee_id: input.assignee_id,
    sector_name: input.sector_name,
    sector_id: input.sector_id,
  });

  const row = {
    workspace_id: input.workspace_id,
    task_type: input.task_type,
    title: input.title,
    description: input.description ?? null,
    status: input.status || 'open',
    priority: input.priority || 'normal',
    driver_id: input.driver_id ?? null,
    assignee_id: input.assign_strategy === 'fixed' ? input.assignee_id ?? null : assigneeId,
    sector_id: input.sector_id ?? sectorId,
    source: input.source,
    due_at: input.due_at ?? null,
    metadata: input.metadata ?? {},
    conversation_id: input.conversation_id ?? null,
  };

  const { data, error } = await db.from('pending_tasks').insert(row).select('*').single();
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
}

export { TASK_SECTOR_NAMES };
