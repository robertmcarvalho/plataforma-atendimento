import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isTaskTypeCreatable,
  mergeOpsTaskCatalogWithAutomation,
  type OpsTaskAutomationRulesStored,
  type OpsTaskCatalogStored,
  type OpsTaskTrigger,
} from '@plataforma/ops-task-catalog';

const OPS_TASK_CATALOG_KEY = 'ops_task_catalog';
const OPS_TASK_AUTOMATION_RULES_KEY = 'ops_task_automation_rules';

export async function isTaskTypeCreatableForWorkspace(
  db: SupabaseClient,
  workspaceId: string,
  taskType: string,
  trigger: OpsTaskTrigger
): Promise<boolean> {
  const [{ data: catalogRow }, { data: rulesRow }] = await Promise.all([
    db.from('app_settings').select('value').eq('workspace_id', workspaceId).eq('key', OPS_TASK_CATALOG_KEY).maybeSingle(),
    db.from('app_settings').select('value').eq('workspace_id', workspaceId).eq('key', OPS_TASK_AUTOMATION_RULES_KEY).maybeSingle(),
  ]);
  const stored =
    catalogRow?.value && typeof catalogRow.value === 'object' ? (catalogRow.value as OpsTaskCatalogStored) : null;
  const rules =
    rulesRow?.value && typeof rulesRow.value === 'object'
      ? ((rulesRow.value as OpsTaskAutomationRulesStored).rules || [])
      : [];
  const catalog = mergeOpsTaskCatalogWithAutomation(stored, rules);
  return isTaskTypeCreatable(catalog, taskType, trigger);
}
