import { addDaysIso, formatIsoDate, uiWeekdayToJsDay, weekBoundsMonSun } from './dates';
import type { ApuracaoContext, DiscountRule } from './types';

function parseIso(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}

/** Dia de pagamento configurado para falta (UI weekday, default quinta=4). */
export function absencePaymentWeekdayUi(rule: DiscountRule): number {
  if (rule.daysOfWeek?.length) return rule.daysOfWeek[0]!;
  return 4;
}

/**
 * Semana seg–dom do evento + pagamento na semana seguinte no dia configurado.
 * Ex.: evento 13/05 (ciclo 11/05–17/05) → pagamento 21/05 se dia=quinta.
 */
export function resolveAbsencePaymentDate(eventDateIso: string, absenceRule: DiscountRule): string {
  const eventWeek = weekBoundsMonSun(eventDateIso);
  const monday = parseIso(eventWeek.startDate);
  const payUi = absencePaymentWeekdayUi(absenceRule);
  const targetJs = uiWeekdayToJsDay(payUi);
  const offset = 7 + ((targetJs - 1 + 7) % 7);
  const pay = new Date(monday);
  pay.setUTCDate(monday.getUTCDate() + offset);
  return formatIsoDate(pay);
}

export function buildAbsenceApuracao(eventDateIso: string, absenceRule: DiscountRule): ApuracaoContext {
  const apuracao = weekBoundsMonSun(eventDateIso);
  const paymentDate = resolveAbsencePaymentDate(eventDateIso, absenceRule);
  return {
    eventDate: eventDateIso,
    apuracaoStart: apuracao.startDate,
    apuracaoEnd: apuracao.endDate,
    paymentDate,
  };
}
