import type { DiscountRule, DiscountRuleKind } from './types';

export const DEFAULT_FINANCIAL_DISCOUNT_RULES: Record<string, DiscountRule> = {
  quota: { type: 'quota', kind: 'monthly_weekday', daysOfWeek: [], dayOfMonth: 0, monthlyNth: 2, monthlyWeekday: 4 },
  bag: { type: 'bag', kind: 'weekly', daysOfWeek: [2, 4], dayOfMonth: 0, monthlyNth: 0, monthlyWeekday: 0 },
  uniform: { type: 'uniform', kind: 'weekly', daysOfWeek: [2, 4], dayOfMonth: 0, monthlyNth: 0, monthlyWeekday: 0 },
  digital_cert: { type: 'digital_cert', kind: 'monthly_weekday', daysOfWeek: [], dayOfMonth: 0, monthlyNth: 2, monthlyWeekday: 4 },
  advance: { type: 'advance', kind: 'weekly', daysOfWeek: [4], dayOfMonth: 0, monthlyNth: 0, monthlyWeekday: 0 },
  absence: { type: 'absence', kind: 'apuracao_cycle', daysOfWeek: [4], dayOfMonth: 0, monthlyNth: 0, monthlyWeekday: 0 },
  daily: {
    type: 'daily',
    kind: 'weekly',
    daysOfWeek: [2, 4],
    dayOfMonth: 0,
    monthlyNth: 0,
    monthlyWeekday: 0,
    submissionCutoffHour: 11,
  },
  other: { type: 'other', kind: 'weekly', daysOfWeek: [4], dayOfMonth: 0, monthlyNth: 0, monthlyWeekday: 0 },
};

export function buildDefaultRuleForType(type: string): DiscountRule {
  return (
    DEFAULT_FINANCIAL_DISCOUNT_RULES[type] ?? {
      type,
      kind: 'weekly',
      daysOfWeek: [4],
      dayOfMonth: 0,
      monthlyNth: 0,
      monthlyWeekday: 0,
    }
  );
}

export function mergeDiscountRulesFromJson(raw: unknown): Record<string, DiscountRule> {
  const out: Record<string, DiscountRule> = JSON.parse(JSON.stringify(DEFAULT_FINANCIAL_DISCOUNT_RULES));
  if (!raw || typeof raw !== 'object') return normalizeLegacyRules(out);
  const obj = raw as Record<string, unknown>;
  const rules =
    obj.rules && typeof obj.rules === 'object'
      ? (obj.rules as Record<string, Partial<DiscountRule>>)
      : (raw as Record<string, Partial<DiscountRule>>);
  for (const key of Object.keys(out)) {
    const patch = rules[key];
    if (patch && typeof patch === 'object') {
      out[key] = { ...out[key], ...patch };
    }
  }
  for (const key of Object.keys(rules)) {
    if (key in out) continue;
    if (!/^[a-z][a-z0-9_]{0,30}$/.test(key)) continue;
    const patch = rules[key];
    if (!patch || typeof patch !== 'object') continue;
    out[key] = { ...buildDefaultRuleForType(key), ...patch, type: key };
  }
  return normalizeLegacyRules(out);
}

/** immediate → apuracao_cycle; garante dia de pagamento. */
function normalizeLegacyRules(rules: Record<string, DiscountRule>): Record<string, DiscountRule> {
  const absence = rules.absence;
  if (absence) {
    if (absence.kind === 'immediate') {
      absence.kind = 'apuracao_cycle';
    }
    if (!absence.daysOfWeek?.length) {
      absence.daysOfWeek = [4];
    }
  }
  return rules;
}

export function getRuleForType(type: string, rules: Record<string, DiscountRule>): DiscountRule {
  return rules[type] ?? buildDefaultRuleForType(type);
}

export function summarizeRuleForType(type: string, rules: Record<string, DiscountRule>): string {
  const r = getRuleForType(type, rules);
  if (type === 'daily') {
    const days = r.daysOfWeek.length ? r.daysOfWeek.join(', ') : '—';
    return `Diária: crédito nos dias ${days} (1=Seg); corte ${r.submissionCutoffHour ?? 11}h.`;
  }
  if (r.kind === 'apuracao_cycle' || (type === 'absence' && r.kind === 'immediate')) {
    const pay = r.daysOfWeek[0] ?? 4;
    return `Falta: desconto no dia de pagamento ${pay} (1=Seg), após ciclo seg–dom do evento.`;
  }
  if (r.kind === 'weekly' && r.daysOfWeek.length) {
    return `${type}: parcelas nos dias ${r.daysOfWeek.join(', ')} (1=Seg).`;
  }
  if (r.kind === 'monthly_weekday') {
    return `${type}: ${r.monthlyNth}ª ocorrência, dia da semana ${r.monthlyWeekday} (1=Seg).`;
  }
  return `${type}: ${r.kind}`;
}

export const RULE_KIND_LABELS: Record<DiscountRuleKind, string> = {
  exact: 'Data exata',
  weekly: 'Dias da semana',
  monthly: 'Dia do mês',
  monthly_weekday: 'Ocorrência mensal',
  immediate: 'Imediato (legado)',
  apuracao_cycle: 'Ciclo de apuração',
};
