import { addDaysIso, formatIsoDate, uiWeekdayToJsDay } from './dates';
import type { DiscountRule } from './types';

function parseIso(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}

/** Próximo dia de pagamento (UI 1=Seg … 7=Dom) em ou após a data âncora. */
export function nextWeekdayOnOrAfterIso(baseIso: string, weekdayUi: number): string {
  const targetJs = uiWeekdayToJsDay(weekdayUi);
  const base = parseIso(baseIso);
  const baseJs = base.getUTCDay();
  const add = (targetJs - baseJs + 7) % 7;
  const pay = new Date(base);
  pay.setUTCDate(base.getUTCDate() + add);
  return formatIsoDate(pay);
}

export function nthWeekdayInMonthUtc(year: number, monthIndex: number, nth: number, weekdayUi: number): string {
  const targetJs = uiWeekdayToJsDay(weekdayUi);
  if (nth >= 1 && nth <= 4) {
    let count = 0;
    for (let d = 1; d <= 31; d++) {
      const dt = new Date(Date.UTC(year, monthIndex, d, 12, 0, 0));
      if (dt.getUTCMonth() !== monthIndex) break;
      if (dt.getUTCDay() === targetJs) {
        count++;
        if (count === nth) return formatIsoDate(dt);
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
    if (last) return formatIsoDate(last);
  }
  return formatIsoDate(new Date(Date.UTC(year, monthIndex, 1, 12, 0, 0)));
}

function collectWeeklyPaymentDates(anchorIso: string, daysUi: number[], count: number): string[] {
  const days = daysUi.length ? [...daysUi].sort((a, b) => a - b) : [4];
  const out: string[] = [];
  let cursor = anchorIso;
  let guard = 0;
  while (out.length < count && guard < 400) {
    guard++;
    let best: string | null = null;
    for (const uiDay of days) {
      const cand = nextWeekdayOnOrAfterIso(cursor, uiDay);
      if (!best || cand < best) best = cand;
    }
    if (!best) break;
    if (out.length === 0 && best < anchorIso) {
      cursor = addDaysIso(anchorIso, 1);
      continue;
    }
    if (out.includes(best)) {
      cursor = addDaysIso(best, 1);
      continue;
    }
    out.push(best);
    cursor = addDaysIso(best, 1);
  }
  return out;
}

function weeklySingleDayDates(anchorIso: string, weekdayUi: number, count: number): string[] {
  const first = nextWeekdayOnOrAfterIso(anchorIso, weekdayUi);
  return Array.from({ length: count }, (_, i) => addDaysIso(first, i * 7));
}

function monthlyWeekdayDates(anchorIso: string, rule: DiscountRule, count: number): string[] {
  const anchor = parseIso(anchorIso);
  let y = anchor.getUTCFullYear();
  let m = anchor.getUTCMonth();
  const nth = rule.monthlyNth || 1;
  const wd = rule.monthlyWeekday || 4;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    let cand = nthWeekdayInMonthUtc(y, m, nth, wd);
    if (out.length === 0 && cand < anchorIso) {
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
      cand = nthWeekdayInMonthUtc(y, m, nth, wd);
    }
    out.push(cand);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

function monthlyDayOfMonthDates(anchorIso: string, rule: DiscountRule, count: number): string[] {
  const anchor = parseIso(anchorIso);
  const dom = Math.min(Math.max(rule.dayOfMonth || 1, 1), 28);
  let y = anchor.getUTCFullYear();
  let m = anchor.getUTCMonth();
  const out: string[] = [];
  while (out.length < count) {
    const iso = formatIsoDate(new Date(Date.UTC(y, m, dom, 12, 0, 0)));
    if (iso >= anchorIso || out.length > 0) out.push(iso);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

function legacyFrequencyDates(anchorIso: string, count: number, frequency: string): string[] {
  const base = parseIso(anchorIso);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const due = new Date(base);
    if (frequency === 'weekly') due.setUTCDate(base.getUTCDate() + i * 7);
    else due.setUTCMonth(base.getUTCMonth() + i);
    out.push(formatIsoDate(due));
  }
  return out;
}

/**
 * Gera datas de vencimento das parcelas conforme regra do tipo (Configurações → Financeiro).
 */
export function generateInstallmentDueDates(
  rule: DiscountRule,
  anchorDateIso: string,
  count: number,
  legacyFrequency = 'weekly'
): string[] {
  if (count <= 0) return [];
  const anchor = anchorDateIso;

  if (rule.kind === 'weekly' && rule.daysOfWeek.length > 0) {
    if (rule.daysOfWeek.length === 1) {
      return weeklySingleDayDates(anchor, rule.daysOfWeek[0]!, count);
    }
    return collectWeeklyPaymentDates(anchor, rule.daysOfWeek, count);
  }

  if (rule.kind === 'monthly_weekday') {
    return monthlyWeekdayDates(anchor, rule, count);
  }

  if (rule.kind === 'monthly' && rule.dayOfMonth > 0) {
    return monthlyDayOfMonthDates(anchor, rule, count);
  }

  if (rule.kind === 'exact') {
    const first = anchor;
    if (count === 1) return [first];
    return legacyFrequencyDates(first, count, legacyFrequency);
  }

  return legacyFrequencyDates(anchor, count, legacyFrequency);
}
