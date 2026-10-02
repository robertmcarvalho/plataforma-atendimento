import { parseISO } from './parseIso';
import { getRuleForType } from './rules';
import { resolveDailyPaymentDate } from './daily';
import { resolveAbsencePaymentDate } from './absence';
import { uiWeekdayToJsDay } from './dates';
import type { ConferenceEntryLike, DiscountRule } from './types';

function parseLocalDateRef(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfWeekMonday(ref: Date): Date {
  const day = ref.getDay();
  const offset = (day + 6) % 7;
  const monday = new Date(ref);
  monday.setDate(ref.getDate() - offset);
  return monday;
}

function addDaysLocal(d: Date, days: number): Date {
  const n = new Date(d);
  n.setDate(d.getDate() + days);
  return n;
}

/** UI weekdays (1–7) em que o seletor de conferência é válido. */
export function listConferencePaymentWeekdays(rules: Record<string, DiscountRule>): number[] {
  const set = new Set<number>();
  const daily = rules.daily;
  if (daily?.daysOfWeek?.length) {
    for (const d of daily.daysOfWeek) set.add(d);
  }
  for (const [slug, rule] of Object.entries(rules)) {
    if (slug === 'daily') continue;
    if (rule.kind === 'weekly' && rule.daysOfWeek.length) {
      for (const d of rule.daysOfWeek) set.add(d);
    }
    if (rule.kind === 'apuracao_cycle' || (slug === 'absence' && rule.kind === 'immediate')) {
      set.add(absencePaymentWeekdayUi(rule));
    }
  }
  return [...set].sort((a, b) => a - b);
}

function absencePaymentWeekdayUi(rule: DiscountRule): number {
  if (rule.daysOfWeek?.length) return rule.daysOfWeek[0]!;
  return 4;
}

/** Dia da semana UI (1–7) da data selecionada, ou null se não for dia de pagamento configurado. */
export function conferenceWeekdayUiFromRef(iso: string, rules: Record<string, DiscountRule>): number | null {
  const d = parseLocalDateRef(iso);
  if (Number.isNaN(d.getTime())) return null;
  const ui = d.getDay() === 0 ? 7 : d.getDay();
  const allowed = listConferencePaymentWeekdays(rules);
  return allowed.includes(ui) ? ui : null;
}

function nthWeekdayInMonthLocal(year: number, monthIndex: number, nth: number, weekdayUi: number): Date {
  const targetJs = uiWeekdayToJsDay(weekdayUi);
  let count = 0;
  for (let day = 1; day <= 31; day++) {
    const dt = new Date(year, monthIndex, day, 12, 0, 0);
    if (dt.getMonth() !== monthIndex) break;
    if (dt.getDay() === targetJs) {
      count++;
      if (count === nth) return dt;
    }
  }
  if (nth === 5) {
    let last: Date | null = null;
    for (let day = 1; day <= 31; day++) {
      const dt = new Date(year, monthIndex, day, 12, 0, 0);
      if (dt.getMonth() !== monthIndex) break;
      if (dt.getDay() === targetJs) last = dt;
    }
    if (last) return last;
  }
  return new Date(year, monthIndex, 1, 12, 0, 0);
}

/**
 * Terça (ou dia só de diária): apenas diárias com pagamento na data selecionada.
 * Outros dias de pagamento: diárias + descontos conforme regra/parcela.
 */
export function matchesConferenceDate(
  entry: ConferenceEntryLike,
  selectedDateIso: string,
  rules: Record<string, DiscountRule>
): boolean {
  const installments = entry.financial_installments ?? [];
  const rule = getRuleForType(entry.type, rules);
  const selectedUi = conferenceWeekdayUiFromRef(selectedDateIso, rules);
  if (selectedUi === null) return false;

  const dailyRule = rules.daily ?? getRuleForType('daily', rules);

  /** Terça (ex.): só diárias; quinta (dia de liquidação): diárias + descontos. */
  if (isDailyExclusiveConferenceDay(selectedUi, rules) && entry.type !== 'daily') {
    return false;
  }

  if (entry.type === 'daily') {
    const createdAt = parseISO(entry.created_at);
    const payIso = resolveDailyPaymentDate(createdAt, dailyRule);
    if (payIso !== selectedDateIso) return false;
    return installments.length === 0 || installments.some((i) => i.due_date === selectedDateIso);
  }

  if (entry.type === 'absence') {
    const eventDate = entry.event_date || entry.start_date;
    if (!eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return false;
    const payIso = resolveAbsencePaymentDate(eventDate, rule);
    if (payIso !== selectedDateIso) return false;
    return installments.length === 0 || installments.some((i) => i.due_date === selectedDateIso);
  }

  if (rule.kind === 'weekly' && rule.daysOfWeek.length > 0) {
    const refLocal = parseLocalDateRef(selectedDateIso);
    const weekStart = startOfWeekMonday(refLocal);
    const targetDates = rule.daysOfWeek.map((uiDay) => {
      const js = uiWeekdayToJsDay(uiDay);
      const offset = (js + 7 - 1) % 7;
      return formatLocalDate(addDaysLocal(weekStart, offset));
    });
    if (!targetDates.includes(selectedDateIso)) return false;
    return installments.some((i) => i.due_date === selectedDateIso);
  }

  if (rule.kind === 'monthly_weekday') {
    const ref = parseLocalDateRef(selectedDateIso);
    const nth = rule.monthlyNth || 1;
    const weekdayUi = rule.monthlyWeekday ?? 4;
    const due = nthWeekdayInMonthLocal(ref.getFullYear(), ref.getMonth(), nth, weekdayUi);
    const dueIso = formatLocalDate(due);
    if (dueIso !== selectedDateIso) return false;
    return installments.some((i) => i.due_date === selectedDateIso);
  }

  if (rule.kind === 'apuracao_cycle' || rule.kind === 'immediate') {
    return installments.some((i) => i.due_date === selectedDateIso);
  }

  return installments.some((i) => i.due_date === selectedDateIso);
}

/** Dia de conferência só para crédito de diária (não liquidação geral). */
export function isDailyExclusiveConferenceDay(
  selectedUi: number,
  rules: Record<string, DiscountRule>
): boolean {
  const dailyDays = rules.daily?.daysOfWeek ?? [2, 4];
  if (!dailyDays.includes(selectedUi)) return false;
  const settlementDay = absencePaymentWeekdayUi(rules.absence ?? getRuleForType('absence', rules));
  return selectedUi !== settlementDay;
}

/** Dia de conferência com pagamento de diárias (ex.: terça e quinta). */
export function isDailyPaymentConferenceDay(
  selectedUi: number,
  rules: Record<string, DiscountRule>
): boolean {
  const dailyDays = rules.daily?.daysOfWeek ?? [2, 4];
  return dailyDays.includes(selectedUi);
}

export function primarySettlementWeekdayUi(rules: Record<string, DiscountRule>): number {
  return absencePaymentWeekdayUi(rules.absence ?? getRuleForType('absence', rules));
}
