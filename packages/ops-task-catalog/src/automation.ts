import type { OpsTaskAutomationEvent, OpsTaskAutomationRule, OpsTaskAutomationRulesStored } from './types';

export const OPS_TASK_AUTOMATION_EVENT_LABELS: Record<OpsTaskAutomationEvent, string> = {
  internal_note_pattern: 'Nota interna (padrão de texto)',
  driver_doc_expiring: 'Documento a vencer',
  driver_doc_expired: 'Documento vencido',
};

export const EVENT_TO_TRIGGER = {
  internal_note_pattern: 'internal_note',
  driver_doc_expiring: 'scheduler_doc',
  driver_doc_expired: 'scheduler_doc',
} as const;

export function defaultOpsTaskAutomationRules(): OpsTaskAutomationRulesStored {
  return { rules: [] };
}

export function validateOpsTaskAutomationRulesPayload(
  value: unknown
): { ok: true; data: OpsTaskAutomationRulesStored } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: 'Regras de automação devem ser um objeto com rules' };
  }
  const rules = (value as OpsTaskAutomationRulesStored).rules;
  if (!Array.isArray(rules)) {
    return { ok: false, error: 'rules deve ser um array' };
  }

  const seen = new Set<string>();
  const normalized: OpsTaskAutomationRule[] = [];

  for (const raw of rules) {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: 'Regra inválida' };
    }
    const id = String((raw as OpsTaskAutomationRule).id || '').trim();
    const event = (raw as OpsTaskAutomationRule).event;
    const task_type = String((raw as OpsTaskAutomationRule).task_type || '').trim();
    if (!id) return { ok: false, error: 'id obrigatório em cada regra' };
    if (seen.has(id)) return { ok: false, error: `id duplicado: ${id}` };
    seen.add(id);

    if (!['internal_note_pattern', 'driver_doc_expiring', 'driver_doc_expired'].includes(event)) {
      return { ok: false, error: `event inválido: ${String(event)}` };
    }
    if (!task_type) return { ok: false, error: 'task_type obrigatório em cada regra' };

    const pattern = (raw as OpsTaskAutomationRule).pattern?.trim();
    if (event === 'internal_note_pattern') {
      if (!pattern) return { ok: false, error: `pattern obrigatório para regra ${id}` };
      try {
        // eslint-disable-next-line no-new
        new RegExp(pattern, 'i');
      } catch {
        return { ok: false, error: `pattern regex inválido na regra ${id}` };
      }
    }

    const days_before = (raw as OpsTaskAutomationRule).days_before;
    if (event === 'driver_doc_expiring') {
      const days = Number(days_before);
      if (!Number.isFinite(days) || days < 1 || days > 90) {
        return { ok: false, error: `days_before inválido na regra ${id}` };
      }
    }

    normalized.push({
      id,
      event,
      task_type,
      enabled: (raw as OpsTaskAutomationRule).enabled !== false,
      ...(pattern ? { pattern } : {}),
      ...(event === 'driver_doc_expiring' && days_before != null ? { days_before: Number(days_before) } : {}),
    });
  }

  return { ok: true, data: { rules: normalized } };
}

export function rulesForTaskType(rules: OpsTaskAutomationRule[], taskType: string): OpsTaskAutomationRule[] {
  return rules.filter((r) => r.task_type === taskType);
}

export function rulesForEvent(rules: OpsTaskAutomationRule[], event: OpsTaskAutomationEvent): OpsTaskAutomationRule[] {
  return rules.filter((r) => r.enabled && r.event === event);
}

export function resolveDocAlertTaskTypeFromRules(
  rules: OpsTaskAutomationRule[],
  alertKind: 'expiring' | 'expired'
): string {
  const event: OpsTaskAutomationEvent =
    alertKind === 'expiring' ? 'driver_doc_expiring' : 'driver_doc_expired';
  const custom = rulesForEvent(rules, event).find((r) => !r.task_type.startsWith('driver_doc_'));
  if (custom) return custom.task_type;
  return alertKind === 'expiring' ? 'driver_doc_expiry_warning' : 'driver_doc_expired';
}
