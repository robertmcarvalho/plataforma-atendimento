import type { DiscountRule } from '@/lib/financialCycle';
import { DEFAULT_FINANCIAL_DISCOUNT_RULES } from '@/lib/financialCycle';

export const DEFAULT_DISCOUNT_RULES = DEFAULT_FINANCIAL_DISCOUNT_RULES;

export function buildDefaultRule(type: string): DiscountRule {
  return (
    DEFAULT_DISCOUNT_RULES[type] ?? {
      type,
      kind: 'weekly',
      daysOfWeek: [4],
      dayOfMonth: 0,
      monthlyNth: 0,
      monthlyWeekday: 0,
    }
  );
}

export const WEEK_DAYS = [
  { value: 1, label: 'Segunda' },
  { value: 2, label: 'Terça' },
  { value: 3, label: 'Quarta' },
  { value: 4, label: 'Quinta' },
  { value: 5, label: 'Sexta' },
  { value: 6, label: 'Sábado' },
  { value: 7, label: 'Domingo' },
];

export function getRuleForType(type: string, rules: Record<string, DiscountRule>) {
  return rules[type] || DEFAULT_DISCOUNT_RULES[type] || { type, kind: 'exact', daysOfWeek: [], dayOfMonth: 1, monthlyNth: 1, monthlyWeekday: 4 };
}

/** UI: 1=Seg … 7=Dom — alinhado a WEEK_DAYS (não usar getDay() direto na regra). */
function uiWeekdayToJsDay(ui: number): number {
  if (ui === 7) return 0;
  return ui;
}

/** n-ésima (1–4) ou última (5) ocorrência do weekday (UI) no mês local de `year`/`monthIndex`. */
function nthWeekdayInMonthLocal(year: number, monthIndex: number, nth: number, weekdayUi: number): Date {
  const targetDow = uiWeekdayToJsDay(weekdayUi);
  if (nth >= 1 && nth <= 4) {
    let count = 0;
    for (let d = 1; d <= 31; d++) {
      const dt = new Date(year, monthIndex, d);
      if (dt.getMonth() !== monthIndex) break;
      if (dt.getDay() === targetDow) {
        count++;
        if (count === nth) return dt;
      }
    }
  }
  if (nth === 5) {
    let last: Date | null = null;
    for (let d = 1; d <= 31; d++) {
      const dt = new Date(year, monthIndex, d);
      if (dt.getMonth() !== monthIndex) break;
      if (dt.getDay() === targetDow) last = dt;
    }
    if (last) return last;
  }
  return new Date(year, monthIndex, 1);
}

export function summarizeRuleForType(
  type: string,
  rules: Record<string, DiscountRule>,
  labels: Record<string, string>
): string {
  const r = getRuleForType(type, rules);
  const label = labels[type] || type;
  if (type === 'daily') {
    return `Diária: pagamentos Ter/Qui; corte ${r.submissionCutoffHour ?? 11}h (data de início definida na criação).`;
  }
  if (r.kind === 'immediate') return `${label}: desconto no ciclo da criação.`;
  if (r.kind === 'weekly' && r.daysOfWeek.length)
    return `${label}: semanal nos dias ${r.daysOfWeek.join(', ')} (1=Seg … 7=Dom).`;
  if (r.kind === 'monthly_weekday')
    return `${label}: ${r.monthlyNth}ª ocorrência (5=última), dia da semana ${r.monthlyWeekday} (1=Seg … 7=Dom).`;
  return `${label}: ${r.kind}`;
}
