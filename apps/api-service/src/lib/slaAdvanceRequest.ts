import { supabase } from './supabase';

export type SlaAdvanceRequestConfig = {
  sla_minutes: number;
  warning_pct: number;
  reminder_minutes: number;
  escalate_after_x: number;
  supervisor_role: string;
  fallback_admin_role: string;
};

const DEFAULTS: SlaAdvanceRequestConfig = {
  sla_minutes: 120,
  warning_pct: 0.8,
  reminder_minutes: 30,
  escalate_after_x: 2,
  supervisor_role: 'supervisor',
  fallback_admin_role: 'admin',
};

function clampPct(n: number): number {
  if (!Number.isFinite(n) || n <= 0 || n >= 1) return 0.8;
  return n;
}

/** Carrega `app_settings.sla_advance_request` com defaults seguros. */
export async function loadSlaAdvanceRequestConfig(): Promise<SlaAdvanceRequestConfig> {
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'sla_advance_request').maybeSingle();
  const v = (data?.value || {}) as Partial<SlaAdvanceRequestConfig>;
  const slaMinutes = Number(v.sla_minutes);
  const reminder = Number(v.reminder_minutes);
  const esc = Number(v.escalate_after_x);
  return {
    sla_minutes: slaMinutes > 0 ? slaMinutes : DEFAULTS.sla_minutes,
    warning_pct: clampPct(Number(v.warning_pct ?? DEFAULTS.warning_pct)),
    reminder_minutes: reminder > 0 ? reminder : DEFAULTS.reminder_minutes,
    escalate_after_x: esc > 0 ? esc : DEFAULTS.escalate_after_x,
    supervisor_role: typeof v.supervisor_role === 'string' && v.supervisor_role.trim()
      ? v.supervisor_role.trim()
      : DEFAULTS.supervisor_role,
    fallback_admin_role:
      typeof v.fallback_admin_role === 'string' && v.fallback_admin_role.trim()
        ? v.fallback_admin_role.trim()
        : DEFAULTS.fallback_admin_role,
  };
}

export function computeAdvanceDueAtIso(now: Date, cfg: SlaAdvanceRequestConfig): string {
  return new Date(now.getTime() + cfg.sla_minutes * 60 * 1000).toISOString();
}

/** Alerta preventivo: `due_at` menos (1 - warning_pct) × SLA (ex.: 80% => 20% antes do vencimento). */
export function computeWarningAtMs(dueAtMs: number, cfg: SlaAdvanceRequestConfig): number {
  const offset = (1 - clampPct(cfg.warning_pct)) * cfg.sla_minutes * 60 * 1000;
  return dueAtMs - offset;
}

/** Escalonamento: após `escalate_after_x` × duração do SLA desde a criação (due = created + 1× SLA). */
export function computeEscalateAtMs(createdAtMs: number, cfg: SlaAdvanceRequestConfig): number {
  return createdAtMs + cfg.escalate_after_x * cfg.sla_minutes * 60 * 1000;
}
