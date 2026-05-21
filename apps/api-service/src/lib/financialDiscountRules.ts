/**
 * Regras de desconto / ciclo (espelho do contrato usado no front financeiro).
 * DEFAULT alinhado a apps/web financial/page.tsx — persistido em app_settings.financial_discount_rules.
 */

export type DiscountRuleKind = 'exact' | 'weekly' | 'monthly' | 'monthly_weekday' | 'immediate';

export interface DiscountRule {
  type: string;
  kind: DiscountRuleKind;
  daysOfWeek: number[];
  dayOfMonth: number;
  monthlyNth: number;
  monthlyWeekday: number;
  submissionCutoffHour?: number;
  submissionCutoffDay?: number;
}

export const DEFAULT_FINANCIAL_DISCOUNT_RULES: Record<string, DiscountRule> = {
  quota: { type: 'quota', kind: 'monthly_weekday', daysOfWeek: [], dayOfMonth: 0, monthlyNth: 2, monthlyWeekday: 4 },
  bag: { type: 'bag', kind: 'weekly', daysOfWeek: [2, 4], dayOfMonth: 0, monthlyNth: 0, monthlyWeekday: 0 },
  uniform: { type: 'uniform', kind: 'weekly', daysOfWeek: [2, 4], dayOfMonth: 0, monthlyNth: 0, monthlyWeekday: 0 },
  digital_cert: { type: 'digital_cert', kind: 'monthly_weekday', daysOfWeek: [], dayOfMonth: 0, monthlyNth: 2, monthlyWeekday: 4 },
  advance: { type: 'advance', kind: 'weekly', daysOfWeek: [4], dayOfMonth: 0, monthlyNth: 0, monthlyWeekday: 0 },
  absence: { type: 'absence', kind: 'immediate', daysOfWeek: [], dayOfMonth: 0, monthlyNth: 0, monthlyWeekday: 0 },
  daily: { type: 'daily', kind: 'weekly', daysOfWeek: [2, 4], dayOfMonth: 0, monthlyNth: 0, monthlyWeekday: 0, submissionCutoffHour: 11 },
  other: { type: 'other', kind: 'weekly', daysOfWeek: [4], dayOfMonth: 0, monthlyNth: 0, monthlyWeekday: 0 },
};

/** Regra default usada quando um novo tipo customizado é criado via /entry-types. */
export function buildDefaultRuleForType(type: string): DiscountRule {
  return {
    type,
    kind: 'weekly',
    daysOfWeek: [4],
    dayOfMonth: 0,
    monthlyNth: 0,
    monthlyWeekday: 0,
  };
}

/** UI: 1=Seg … 7=Dom → JS getDay 0=Dom … 6=Sab */
export function uiWeekdayToJsDay(ui: number): number {
  if (ui === 7) return 0;
  return ui;
}

/** n-ésima ocorrência (1–4) ou última (5) do weekday (UI 1–7) no mês de ref. */
export function nthWeekdayOfMonth(year: number, monthIndex: number, nth: number, weekdayUi: number): Date {
  const targetJs = uiWeekdayToJsDay(weekdayUi);
  if (nth >= 1 && nth <= 4) {
    let count = 0;
    for (let d = 1; d <= 31; d++) {
      const dt = new Date(Date.UTC(year, monthIndex, d, 12, 0, 0));
      if (dt.getUTCMonth() !== monthIndex) break;
      if (dt.getUTCDay() === targetJs) {
        count++;
        if (count === nth) return dt;
      }
    }
  }
  if (nth === 5) {
    let last: Date | null = null;
    for (let d = 1; d <= 31; d++) {
      const dt = new Date(Date.UTC(year, monthIndex, d, 12, 0, 0));
      if (dt.getUTCMonth() !== monthIndex) break;
      if (dt.getUTCDay() === targetJs) last = dt;
    }
    if (last) return last;
  }
  return new Date(Date.UTC(year, monthIndex, 1, 12, 0, 0));
}

export function mergeDiscountRulesFromJson(raw: unknown): Record<string, DiscountRule> {
  const out: Record<string, DiscountRule> = JSON.parse(JSON.stringify(DEFAULT_FINANCIAL_DISCOUNT_RULES));
  if (!raw || typeof raw !== 'object') return out;
  const obj = raw as Record<string, unknown>;
  const rules = obj.rules && typeof obj.rules === 'object' ? (obj.rules as Record<string, Partial<DiscountRule>>) : (raw as Record<string, Partial<DiscountRule>>);
  // Aplica patches sobre defaults conhecidos.
  for (const key of Object.keys(out)) {
    const patch = rules[key];
    if (patch && typeof patch === 'object') {
      out[key] = { ...out[key], ...patch };
    }
  }
  // Preserva regras de tipos customizados (slugs fora dos defaults).
  for (const key of Object.keys(rules)) {
    if (key in out) continue;
    if (!/^[a-z][a-z0-9_]{0,30}$/.test(key)) continue;
    const patch = rules[key];
    if (!patch || typeof patch !== 'object') continue;
    out[key] = { ...buildDefaultRuleForType(key), ...patch, type: key };
  }
  return out;
}

/**
 * Próxima data de início (YYYY-MM-DD) para lançamento tipo diária, conforme cutoff (padrão 11h)
 * entre janelas Ter↔Qui (mesma heurística que financial.ts).
 */
export function resolveDailyEntryStartDateIso(now: Date, dailyRule: DiscountRule): string {
  const cutoffHour = dailyRule.submissionCutoffHour ?? 11;
  const day = now.getDay();
  const hour = now.getHours();

  const isAfterTueLimit = (day === 2 && hour >= cutoffHour) || day > 2;
  const isBeforeQuiLimit = day < 4 || (day === 4 && hour < cutoffHour);

  let paymentDate: Date;
  if (isAfterTueLimit && isBeforeQuiLimit) {
    const nextQui = new Date(now);
    const add = (4 + 7 - now.getDay()) % 7;
    nextQui.setDate(now.getDate() + add);
    paymentDate = nextQui;
  } else {
    const nextTer = new Date(now);
    nextTer.setDate(now.getDate() + ((2 + 7 - now.getDay()) % 7));
    if (day === 4 && hour >= cutoffHour) nextTer.setDate(nextTer.getDate() + 7);
    paymentDate = nextTer;
  }
  return paymentDate.toISOString().split('T')[0];
}

/** Texto curto para tela de aprovação (server pode enviar ao front ou duplicar lógica no front). */
export function summarizeRuleForType(type: string, rules: Record<string, DiscountRule>): string {
  const r = rules[type] || DEFAULT_FINANCIAL_DISCOUNT_RULES[type];
  if (!r) return '—';
  if (type === 'daily') {
    return `Diária: pagamentos Ter/Qui; corte ${r.submissionCutoffHour ?? 11}h (regra automática de data de início).`;
  }
  if (r.kind === 'immediate') return `${type}: desconto no ciclo da criação.`;
  if (r.kind === 'weekly' && r.daysOfWeek.length)
    return `${type}: semanal nos dias da semana ${r.daysOfWeek.join(', ')} (1=Seg).`;
  if (r.kind === 'monthly_weekday')
    return `${type}: ${r.monthlyNth}ª ocorrência (5=última) no dia da semana ${r.monthlyWeekday} (1=Seg).`;
  return `${type}: ${r.kind}`;
}
