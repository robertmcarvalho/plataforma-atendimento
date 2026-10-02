import { addDaysIso, formatIsoDate, uiWeekdayToJsDay } from './dates';
import type { DiscountRule } from './types';

const SP_WEEKDAY_TO_JS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function parseLocalSp(createdAt: Date): { jsDay: number; minutesOfDay: number; todayIso: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(createdAt);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const todayIso = `${pick('year')}-${pick('month')}-${pick('day')}`;
  const wd = pick('weekday');
  const jsDay = SP_WEEKDAY_TO_JS[wd] ?? 0;
  const hour = Number(pick('hour')) || 0;
  const minute = Number(pick('minute')) || 0;
  return { jsDay, minutesOfDay: hour * 60 + minute, todayIso };
}

/** Próxima data ISO do dia de pagamento (na semana corrente ou seguinte). */
function nextPaymentIsoOnOrAfter(baseIso: string, targetJsDay: number): string {
  const base = new Date(`${baseIso}T12:00:00.000Z`);
  const baseJs = base.getUTCDay();
  let add = (targetJsDay - baseJs + 7) % 7;
  if (add === 0) add = 0;
  const pay = new Date(base);
  pay.setUTCDate(base.getUTCDate() + add);
  return formatIsoDate(pay);
}

/**
 * Resolve dia de pagamento da diária conforme dias configurados + corte horário.
 * Suporta 1+ dias em daysOfWeek (UI 1=Seg … 7=Dom).
 */
export function resolveDailyPaymentDate(createdAt: Date, dailyRule: DiscountRule): string {
  const cutoff = dailyRule.submissionCutoffHour ?? 11;
  const paymentDaysUi = [...(dailyRule.daysOfWeek || [])].sort((a, b) => a - b);
  if (!paymentDaysUi.length) {
    paymentDaysUi.push(4);
  }

  const { jsDay: createdJs, minutesOfDay, todayIso } = parseLocalSp(createdAt);
  const cutoffMinutes = cutoff * 60;
  const afterCutoff = minutesOfDay > cutoffMinutes;
  const atOrBeforeCutoff = !afterCutoff;

  if (paymentDaysUi.length === 1) {
    const targetJs = uiWeekdayToJsDay(paymentDaysUi[0]!);
    let payIso = nextPaymentIsoOnOrAfter(todayIso, targetJs);
    if (createdJs === targetJs && afterCutoff) {
      payIso = addDaysIso(payIso, 7);
    }
    return payIso;
  }

  const paymentJsDays = paymentDaysUi.map(uiWeekdayToJsDay);

  if (paymentJsDays.length === 2) {
    const [firstJs, secondJs] = paymentJsDays;
    let targetJs: number;
    if (createdJs === secondJs && afterCutoff) targetJs = firstJs!;
    else if (createdJs === firstJs && atOrBeforeCutoff) targetJs = firstJs!;
    else if (createdJs === firstJs && afterCutoff) targetJs = secondJs!;
    else if (createdJs === secondJs && atOrBeforeCutoff) targetJs = secondJs!;
    else if (createdJs === 5 || createdJs === 6 || createdJs === 0) targetJs = firstJs!;
    else if (createdJs === 1 && atOrBeforeCutoff) targetJs = firstJs!;
    else if (createdJs === 1 && afterCutoff) targetJs = secondJs!;
    else if (createdJs === 3) targetJs = secondJs!;
    else targetJs = secondJs!;

    let payIso = nextPaymentIsoOnOrAfter(todayIso, targetJs);
    if (createdJs === targetJs && afterCutoff) {
      payIso = addDaysIso(payIso, 7);
    }
    return payIso;
  }

  for (let i = 0; i < paymentJsDays.length; i++) {
    const payJs = paymentJsDays[i]!;
    const prevJs = paymentJsDays[(i - 1 + paymentJsDays.length) % paymentJsDays.length]!;
    const inWindow = isInPaymentWindow(createdJs, minutesOfDay, prevJs, payJs, cutoffMinutes);
    if (inWindow) {
      let payIso = nextPaymentIsoOnOrAfter(todayIso, payJs);
      if (createdJs === payJs && afterCutoff) payIso = addDaysIso(payIso, 7);
      return payIso;
    }
  }

  const fallbackJs = paymentJsDays[0]!;
  return nextPaymentIsoOnOrAfter(todayIso, fallbackJs);
}

function isInPaymentWindow(
  createdJs: number,
  minutesOfDay: number,
  prevPayJs: number,
  payJs: number,
  cutoffMinutes: number
): boolean {
  if (createdJs === payJs && minutesOfDay <= cutoffMinutes) return true;
  if (createdJs === prevPayJs && minutesOfDay > cutoffMinutes) return true;
  const between = dayBetweenCircular(prevPayJs, payJs, createdJs);
  return between && !(createdJs === payJs && minutesOfDay > cutoffMinutes);
}

function dayBetweenCircular(fromJs: number, toJs: number, d: number): boolean {
  if (fromJs < toJs) return d > fromJs && d < toJs;
  return d > fromJs || d < toJs;
}
