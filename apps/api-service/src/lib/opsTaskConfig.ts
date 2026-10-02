import type { SupabaseClient } from '@supabase/supabase-js';
import { CODE_TASK_PLAYBOOKS, type TaskPlaybook } from './taskPlaybooks';
import { loadSlaAdvanceRequestConfig } from './slaAdvanceRequest';

export const OPS_TASK_PLAYBOOKS_KEY = 'ops_task_playbooks';
export const OPS_TASK_SLA_CONFIG_KEY = 'ops_task_sla_config';

export type OpsTaskPlaybooksConfig = Record<
  string,
  {
    steps: Array<{ id: string; label: string }>;
    permissions?: string[];
  }
>;

export type OpsTaskSlaEntry = {
  sla_minutes: number;
  warning_pct?: number;
  reminder_minutes?: number;
  escalate_after_x?: number;
  signature_deadline_days?: number;
  settlement_business_days?: number;
};

export type OpsTaskSlaConfig = Record<string, OpsTaskSlaEntry>;

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

export function defaultOpsTaskPlaybooks(): OpsTaskPlaybooksConfig {
  const out: OpsTaskPlaybooksConfig = {};
  for (const [type, pb] of Object.entries(CODE_TASK_PLAYBOOKS)) {
    out[type] = {
      steps: pb.steps.map((s) => ({ id: s.id, label: s.label })),
      permissions: pb.permissions,
    };
  }
  return out;
}

export async function loadOpsTaskPlaybooks(
  db: SupabaseClient,
  workspaceId: string
): Promise<OpsTaskPlaybooksConfig> {
  const stored = await readJsonSetting<OpsTaskPlaybooksConfig>(db, workspaceId, OPS_TASK_PLAYBOOKS_KEY);
  if (stored && Object.keys(stored).length) return { ...defaultOpsTaskPlaybooks(), ...stored };
  return defaultOpsTaskPlaybooks();
}

export async function defaultOpsTaskSlaConfig(db?: SupabaseClient): Promise<OpsTaskSlaConfig> {
  const advanceCfg = db ? await loadSlaAdvanceRequestConfig() : { sla_minutes: 120, warning_pct: 0.8 };
  return {
    financial_advance_request: {
      sla_minutes: advanceCfg.sla_minutes,
      warning_pct: advanceCfg.warning_pct,
      reminder_minutes: 30,
      escalate_after_x: 2,
    },
    driver_pre_registration: { sla_minutes: 4320, signature_deadline_days: 5 },
    driver_registration_completion: { sla_minutes: 2880 },
    driver_enrollment_prep: { sla_minutes: 4320, signature_deadline_days: 5 },
    driver_termination_prep: { sla_minutes: 2880, signature_deadline_days: 5 },
    driver_termination_request: { sla_minutes: 1440, signature_deadline_days: 5 },
    driver_termination_financial_review: { sla_minutes: 2880, settlement_business_days: 7 },
    driver_doc_expiry_warning: { sla_minutes: 10080 },
    driver_doc_expired: { sla_minutes: 2880 },
    guided_demand: { sla_minutes: 240 },
  };
}

export async function loadOpsTaskSlaConfig(
  db: SupabaseClient,
  workspaceId: string
): Promise<OpsTaskSlaConfig> {
  const defaults = await defaultOpsTaskSlaConfig(db);
  const stored = await readJsonSetting<OpsTaskSlaConfig>(db, workspaceId, OPS_TASK_SLA_CONFIG_KEY);
  if (stored && Object.keys(stored).length) return { ...defaults, ...stored };
  return defaults;
}

export function resolveTaskPlaybook(
  taskType: string,
  config: OpsTaskPlaybooksConfig,
  metadata?: Record<string, unknown>
): TaskPlaybook {
  const fromDb = config[taskType];
  const base = fromDb
    ? {
        steps: fromDb.steps.map((s) => ({ id: s.id, label: s.label })),
        current_step: fromDb.steps[0]?.id || 'review',
        permissions: (fromDb.permissions || ['attendant', 'supervisor']) as TaskPlaybook['permissions'],
      }
    : CODE_TASK_PLAYBOOKS[taskType] ||
      CODE_TASK_PLAYBOOKS.guided_demand || {
        steps: [
          { id: 'review', label: 'Revisar contexto' },
          { id: 'act', label: 'Executar ação' },
          { id: 'close', label: 'Concluir pendência' },
        ],
        current_step: 'review',
        permissions: ['attendant', 'supervisor'],
      };

  const phase = String(metadata?.phase || metadata?.current_phase || '');
  if (taskType === 'driver_pre_registration') {
    if (phase === 'enrollment') return { ...base, current_step: 'enrollment_docs' };
  }
  if (taskType === 'financial_advance_request') {
    if (phase === 'awaiting_entry') return { ...base, current_step: 'entry' };
    if (phase === 'rejected' || phase === 'rejection_followup') return { ...base, current_step: 'decide' };
    if (metadata?.decision) return { ...base, current_step: 'decide' };
  }
  return base;
}

export function computeTaskDueAtIso(taskType: string, slaConfig: OpsTaskSlaConfig, now = new Date()): string | null {
  const entry = slaConfig[taskType];
  if (!entry?.sla_minutes || entry.sla_minutes <= 0) return null;
  return new Date(now.getTime() + entry.sla_minutes * 60 * 1000).toISOString();
}

export function signatureDeadlineDays(taskType: string, slaConfig: OpsTaskSlaConfig): number {
  return slaConfig[taskType]?.signature_deadline_days ?? 5;
}
