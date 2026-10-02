import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  assertTaskTypeCreatable,
  catalogEntryByType,
  formatTaskTitle,
  mergeOpsTaskCatalogWithAutomation,
  resolveDocAlertTaskTypeFromRules,
  rulesForEvent,
  type OpsTaskAutomationRule,
  type OpsTaskAutomationRulesStored,
  type OpsTaskCatalogStored,
  type OpsTaskTrigger,
} from '@plataforma/ops-task-catalog';
const OPS_TASK_CATALOG_KEY = 'ops_task_catalog';
import {
  computeTaskDueAtIso,
  loadOpsTaskPlaybooks,
  loadOpsTaskSlaConfig,
  resolveTaskPlaybook,
} from './opsTaskConfig';

export const OPS_TASK_AUTOMATION_RULES_KEY = 'ops_task_automation_rules';

async function readJsonSetting<T>(db: SupabaseClient, workspaceId: string, key: string): Promise<T | null> {
  const { data } = await db
    .from('app_settings')
    .select('value')
    .eq('workspace_id', workspaceId)
    .eq('key', key)
    .maybeSingle();
  if (!data?.value || typeof data.value !== 'object') return null;
  return data.value as T;
}

export async function loadOpsTaskAutomationRules(
  db: SupabaseClient,
  workspaceId: string
): Promise<OpsTaskAutomationRule[]> {
  const stored = await readJsonSetting<OpsTaskAutomationRulesStored>(db, workspaceId, OPS_TASK_AUTOMATION_RULES_KEY);
  return stored?.rules || [];
}

export async function loadMergedOpsTaskCatalog(db: SupabaseClient, workspaceId: string) {
  const [stored, rules] = await Promise.all([
    readJsonSetting<OpsTaskCatalogStored>(db, workspaceId, OPS_TASK_CATALOG_KEY),
    loadOpsTaskAutomationRules(db, workspaceId),
  ]);
  return mergeOpsTaskCatalogWithAutomation(stored, rules);
}

function playbookChecklist(
  taskType: string,
  playbooksConfig: Awaited<ReturnType<typeof loadOpsTaskPlaybooks>>
) {
  const pb = resolveTaskPlaybook(taskType, playbooksConfig);
  return pb.steps.map((s) => ({ id: s.id, label: s.label, done: false }));
}

export async function createOperacaoAutomatedTask(
  db: SupabaseClient,
  input: {
    workspaceId: string;
    taskType: string;
    trigger: OpsTaskTrigger;
    driverId: string;
    driverName: string;
    assigneeId: string;
    conversationId?: string | null;
    sectorId?: string | null;
    description?: string;
    metadata?: Record<string, unknown>;
    dedupe?: { conversationId?: string | null; field?: string; value?: string };
  }
): Promise<{ id: string; task_type: string; title: string } | null> {
  const catalog = await loadMergedOpsTaskCatalog(db, input.workspaceId);
  let entry;
  try {
    entry = assertTaskTypeCreatable(catalog, input.taskType, input.trigger);
  } catch {
    return null;
  }

  const dupQuery = db
    .from('pending_tasks')
    .select('id, title')
    .eq('workspace_id', input.workspaceId)
    .eq('task_type', input.taskType)
    .in('status', ['open', 'in_progress']);

  if (input.dedupe?.conversationId) {
    dupQuery.eq('conversation_id', input.dedupe.conversationId);
  } else {
    dupQuery.eq('driver_id', input.driverId);
  }

  const { data: openDup } = await dupQuery.limit(1).maybeSingle();
  if (openDup?.id) {
    return { id: String(openDup.id), task_type: input.taskType, title: String(openDup.title) };
  }

  const [playbooksConfig, slaConfig] = await Promise.all([
    loadOpsTaskPlaybooks(db, input.workspaceId),
    loadOpsTaskSlaConfig(db, input.workspaceId),
  ]);

  const title = formatTaskTitle(entry.title_template, { driver_name: input.driverName });
  const { data, error } = await db
    .from('pending_tasks')
    .insert({
      workspace_id: input.workspaceId,
      task_type: input.taskType,
      title: title || `${entry.label}: ${input.driverName}`,
      description: input.description || `Tarefa criada automaticamente (${input.trigger}).`,
      status: 'open',
      priority: 'normal',
      driver_id: input.driverId,
      assignee_id: input.assigneeId,
      sector_id: input.sectorId || null,
      conversation_id: input.conversationId || null,
      source: 'automation',
      due_at: computeTaskDueAtIso(input.taskType, slaConfig),
      metadata: {
        automation_trigger: input.trigger,
        request_id: randomUUID(),
        driver_name: input.driverName,
        playbook_progress: playbookChecklist(input.taskType, playbooksConfig),
        deep_link: '/operacao',
        ...input.metadata,
      },
    })
    .select('id, task_type, title')
    .single();

  if (error || !data) return null;
  return { id: String(data.id), task_type: String(data.task_type), title: String(data.title) };
}

export async function evaluateInternalNoteAutomation(input: {
  db: SupabaseClient;
  workspaceId: string;
  content: string;
  driverId: string;
  driverName: string;
  assigneeId: string;
  conversationId: string;
  sectorId?: string | null;
  noteId: string;
  authorId: string;
}): Promise<Array<{ id: string; task_type: string; title: string }>> {
  const rules = await loadOpsTaskAutomationRules(input.db, input.workspaceId);
  const matches = rulesForEvent(rules, 'internal_note_pattern');
  const created: Array<{ id: string; task_type: string; title: string }> = [];

  for (const rule of matches) {
    if (!rule.pattern) continue;
    let re: RegExp;
    try {
      re = new RegExp(rule.pattern, 'i');
    } catch {
      continue;
    }
    if (!re.test(input.content)) continue;

    const task = await createOperacaoAutomatedTask(input.db, {
      workspaceId: input.workspaceId,
      taskType: rule.task_type,
      trigger: 'internal_note',
      driverId: input.driverId,
      driverName: input.driverName,
      assigneeId: input.assigneeId,
      conversationId: input.conversationId,
      sectorId: input.sectorId,
      description: 'Gatilho automático por padrão em nota interna.',
      metadata: { note_id: input.noteId, author_id: input.authorId, automation_rule_id: rule.id },
      dedupe: { conversationId: input.conversationId },
    });
    if (task) created.push(task);
  }

  return created;
}

export async function resolveDocAlertTaskType(
  db: SupabaseClient,
  workspaceId: string,
  alertKind: 'expiring' | 'expired'
): Promise<string> {
  const rules = await loadOpsTaskAutomationRules(db, workspaceId);
  return resolveDocAlertTaskTypeFromRules(rules, alertKind);
}

export function catalogEntryForType(
  catalog: Awaited<ReturnType<typeof loadMergedOpsTaskCatalog>>,
  taskType: string
) {
  return catalogEntryByType(catalog, taskType);
}
