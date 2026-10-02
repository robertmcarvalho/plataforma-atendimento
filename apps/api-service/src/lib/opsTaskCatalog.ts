import type { SupabaseClient } from '@supabase/supabase-js';
import {
  assertTaskTypeCreatable,
  catalogEntryByType,
  formatTaskTitle,
  isTaskTypeCreatable,
  listManualCreateTypes,
  type OpsTaskCatalogEntry,
  type OpsTaskTrigger,
  validateOpsTaskCatalogPayload,
} from '@plataforma/ops-task-catalog';
import { loadMergedOpsTaskCatalog } from './opsTaskAutomation';

export const OPS_TASK_CATALOG_KEY = 'ops_task_catalog';

export {
  assertTaskTypeCreatable,
  catalogEntryByType,
  formatTaskTitle,
  isTaskTypeCreatable,
  listManualCreateTypes,
  validateOpsTaskCatalogPayload,
  type OpsTaskCatalogEntry,
  type OpsTaskTrigger,
};

export async function loadOpsTaskCatalog(
  db: SupabaseClient,
  workspaceId: string
): Promise<OpsTaskCatalogEntry[]> {
  return loadMergedOpsTaskCatalog(db, workspaceId);
}

export async function assertTaskTypeCreatableForWorkspace(
  db: SupabaseClient,
  workspaceId: string,
  taskType: string,
  trigger: OpsTaskTrigger
): Promise<OpsTaskCatalogEntry> {
  const catalog = await loadOpsTaskCatalog(db, workspaceId);
  return assertTaskTypeCreatable(catalog, taskType, trigger);
}

export async function isTaskTypeCreatableForWorkspace(
  db: SupabaseClient,
  workspaceId: string,
  taskType: string,
  trigger: OpsTaskTrigger
): Promise<boolean> {
  const catalog = await loadOpsTaskCatalog(db, workspaceId);
  return isTaskTypeCreatable(catalog, taskType, trigger);
}
