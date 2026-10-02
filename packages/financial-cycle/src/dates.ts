import type { WeekBounds } from './types';

/** UI: 1=Seg … 7=Dom → JS getDay 0=Dom … 6=Sab */
export function uiWeekdayToJsDay(ui: number): number {
  if (ui === 7) return 0;
  return ui;
}

export function jsDayToUiWeekday(js: number): number {
  if (js === 0) return 7;
  return js;
}

function parseIsoDate(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}

export function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Segunda a domingo da semana que contém a data (UTC noon). */
export function weekBoundsMonSun(referenceDateIso: string): WeekBounds {
  const ref = parseIsoDate(referenceDateIso);
  const day = ref.getUTCDay();
  const offsetToMonday = (day + 6) % 7;
  const monday = new Date(ref);
  monday.setUTCDate(ref.getUTCDate() - offsetToMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { startDate: formatIsoDate(monday), endDate: formatIsoDate(sunday) };
}

/** Semana apurada: seg–dom imediatamente anterior à semana do dia de pagamento. */
export function previousClosedCycleMonSun(paymentDateIso: string): WeekBounds {
  const payWeek = weekBoundsMonSun(paymentDateIso);
  const prevMon = parseIsoDate(payWeek.startDate);
  prevMon.setUTCDate(prevMon.getUTCDate() - 7);
  const prevSun = new Date(prevMon);
  prevSun.setUTCDate(prevMon.getUTCDate() + 6);
  return { startDate: formatIsoDate(prevMon), endDate: formatIsoDate(prevSun) };
}

export function addDaysIso(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return formatIsoDate(d);
}

const WEEKDAY_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function formatWeekdayPt(iso: string): string {
  const d = parseIsoDate(iso);
  return WEEKDAY_PT[d.getUTCDay()] || iso;
}

export function formatBrDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function formatBrDateTime(iso: string, timeZone = 'America/Sao_Paulo'): string {
  try {
    const dt = new Date(iso);
    const date = dt.toLocaleDateString('pt-BR', { timeZone });
    const time = dt.toLocaleTimeString('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
  } catch {
    return iso;
  }
}
