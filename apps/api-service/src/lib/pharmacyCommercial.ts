import {
  getPartsInTimeZone,
  hasCanonicalBusinessHours,
  isOpen,
  normalizeBusinessHours,
  type BusinessHoursConfig,
  type DaySchedule,
  type Weekday,
} from './businessHours';
import { isBrazilianPublicHoliday } from './brPublicHolidays';

const WEEKDAY_SHORT: Record<Weekday, string> = {
  monday: 'Seg',
  tuesday: 'Ter',
  wednesday: 'Qua',
  thursday: 'Qui',
  friday: 'Sex',
  saturday: 'Sáb',
  sunday: 'Dom',
};

const WEEKDAY_ORDER: Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

export type PharmacyCommercialCents = {
  delivery_fee_cents?: number | null;
  delivery_fee_driver_payout_cents?: number | null;
  minimum_guaranteed_cents?: number | null;
  minimum_guaranteed_driver_payout_cents?: number | null;
};

function centsOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

export function parseCommercialTermsInput(input: Record<string, unknown>): PharmacyCommercialCents {
  return {
    delivery_fee_cents: centsOrNull(input.delivery_fee_cents),
    delivery_fee_driver_payout_cents: centsOrNull(input.delivery_fee_driver_payout_cents),
    minimum_guaranteed_cents: centsOrNull(input.minimum_guaranteed_cents),
    minimum_guaranteed_driver_payout_cents: centsOrNull(input.minimum_guaranteed_driver_payout_cents),
  };
}

export function validateCommercialTerms(terms: PharmacyCommercialCents): string | null {
  const fee = terms.delivery_fee_cents;
  const feePayout = terms.delivery_fee_driver_payout_cents;
  if (fee != null && feePayout != null && feePayout > fee) {
    return 'O repasse da taxa de entrega não pode exceder o valor cobrado da farmácia.';
  }
  const min = terms.minimum_guaranteed_cents;
  const minPayout = terms.minimum_guaranteed_driver_payout_cents;
  if (min != null && minPayout != null && minPayout > min) {
    return 'O repasse do mínimo garantido não pode exceder o valor cobrado da farmácia.';
  }
  return null;
}

type HolidayDeliveryRow = {
  is_open: boolean;
  intervals: Array<{ start: string; end: string }>;
};

function parseHolidayDelivery(raw: unknown): HolidayDeliveryRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const intervals = Array.isArray(o.intervals)
    ? (o.intervals as unknown[])
        .map((iv) => {
          if (!iv || typeof iv !== 'object') return null;
          const x = iv as Record<string, unknown>;
          const start = String(x.start || '').trim();
          const end = String(x.end || '').trim();
          if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return null;
          return { start, end };
        })
        .filter(Boolean) as Array<{ start: string; end: string }>
    : [];
  return {
    is_open: o.is_open !== false && intervals.length > 0,
    intervals,
  };
}

function parsePharmacyScheduleExtras(raw: Record<string, unknown>) {
  const deliver_on_holidays = raw.deliver_on_holidays === true;
  const holiday_delivery = parseHolidayDelivery(raw.holiday_delivery);
  return { deliver_on_holidays, holiday_delivery };
}

export function validateDeliveryScheduleInput(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.deliver_on_holidays !== true) return null;
  const hd = parseHolidayDelivery(o.holiday_delivery);
  if (!hd?.is_open || !hd.intervals.length) {
    return 'Informe o horário de entrega em feriados ou desative a entrega em feriados.';
  }
  return null;
}

export function normalizeDeliveryScheduleInput(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const err = validateDeliveryScheduleInput(raw);
  if (err) throw new Error(err);
  const o = raw as Record<string, unknown>;
  const cfg = normalizeBusinessHours(raw as BusinessHoursConfig);
  const base = cfg as unknown as Record<string, unknown>;
  const { deliver_on_holidays, holiday_delivery } = parsePharmacyScheduleExtras(o);
  base.deliver_on_holidays = deliver_on_holidays;
  if (deliver_on_holidays && holiday_delivery) {
    base.holiday_delivery = holiday_delivery;
  } else {
    base.holiday_delivery = { is_open: false, intervals: [] };
  }
  return base;
}

function parseHM(s: string): number {
  const [h, m] = s.split(':').map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

function isOpenForDaySchedule(day: DaySchedule, hour: number, minute: number): boolean {
  if (!day.is_open || !day.intervals.length) return false;
  const cur = hour * 60 + minute;
  for (const iv of day.intervals) {
    const sm = parseHM(iv.start);
    const em = parseHM(iv.end);
    if (cur >= sm && cur < em) return true;
  }
  return false;
}

/** Aberto agora para delivery da farmácia (exceções, feriados nacionais + holiday_delivery). */
export function isPharmacyDeliveryOpen(schedule: unknown, date: Date): boolean {
  if (!schedule || typeof schedule !== 'object' || !hasCanonicalBusinessHours(schedule)) return true;
  const raw = schedule as Record<string, unknown>;
  const cfg = normalizeBusinessHours(schedule);
  const { deliver_on_holidays, holiday_delivery } = parsePharmacyScheduleExtras(raw);
  const parts = getPartsInTimeZone(date, cfg.timezone);
  const ymd = `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;

  const explicit = cfg.holidays.find((h) => h.date === ymd);
  if (explicit) {
    const day: DaySchedule = explicit.is_open && explicit.intervals?.length
      ? { is_open: true, intervals: explicit.intervals }
      : { is_open: false, intervals: [] };
    return isOpenForDaySchedule(day, parts.hour, parts.minute);
  }

  if (isBrazilianPublicHoliday(ymd)) {
    if (!deliver_on_holidays) return false;
    const hd: DaySchedule = holiday_delivery?.is_open && holiday_delivery.intervals.length
      ? { is_open: true, intervals: holiday_delivery.intervals }
      : { is_open: false, intervals: [] };
    return isOpenForDaySchedule(hd, parts.hour, parts.minute);
  }

  return isOpen(cfg, date);
}

export function formatCentsBRL(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return '—';
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatCommercialTermsPt(terms: PharmacyCommercialCents): string[] {
  const lines: string[] = [];
  if (terms.delivery_fee_cents != null) {
    lines.push(
      `Taxa de entrega: ${formatCentsBRL(terms.delivery_fee_cents)}` +
        (terms.delivery_fee_driver_payout_cents != null
          ? ` (repasse entregador: ${formatCentsBRL(terms.delivery_fee_driver_payout_cents)})`
          : '')
    );
  }
  if (terms.minimum_guaranteed_cents != null) {
    lines.push(
      `Mínimo garantido: ${formatCentsBRL(terms.minimum_guaranteed_cents)}` +
        (terms.minimum_guaranteed_driver_payout_cents != null
          ? ` (repasse: ${formatCentsBRL(terms.minimum_guaranteed_driver_payout_cents)})`
          : '')
    );
  }
  return lines;
}

function dayIntervalsLabel(day: { is_open: boolean; intervals: Array<{ start: string; end: string }> }): string {
  if (!day.is_open || !day.intervals.length) return '';
  return day.intervals.map((i) => `${i.start}–${i.end}`).join(', ');
}

export function formatDeliveryScheduleSummary(raw: unknown): string {
  if (!hasCanonicalBusinessHours(raw)) return '';
  const cfg = normalizeBusinessHours(raw);
  const openDays = WEEKDAY_ORDER.filter((key) => {
    const x = cfg.weekly[key];
    return x.is_open && x.intervals.length > 0;
  });
  if (!openDays.length) return '';
  const parts: string[] = [];
  let i = 0;
  while (i < openDays.length) {
    const startKey = openDays[i];
    const sig = dayIntervalsLabel(cfg.weekly[startKey]);
    let j = i;
    while (
      j + 1 < openDays.length &&
      WEEKDAY_ORDER.indexOf(openDays[j + 1]) === WEEKDAY_ORDER.indexOf(openDays[j]) + 1 &&
      dayIntervalsLabel(cfg.weekly[openDays[j + 1]]) === sig
    ) {
      j++;
    }
    const a = openDays[i];
    const b = openDays[j];
    const range = a === b ? WEEKDAY_SHORT[a] : `${WEEKDAY_SHORT[a]}–${WEEKDAY_SHORT[b]}`;
    parts.push(`${range} ${sig}`);
    i = j + 1;
  }
  const weeklySummary = parts.join(' · ');
  if (!weeklySummary) return '';

  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (o.deliver_on_holidays === true) {
      const hd = parseHolidayDelivery(o.holiday_delivery);
      if (hd?.is_open && hd.intervals.length) {
        const iv = hd.intervals.map((i) => `${i.start}–${i.end}`).join(', ');
        return `${weeklySummary} · Feriados: ${iv}`;
      }
      return `${weeklySummary} · Feriados: sim`;
    }
    if (o.deliver_on_holidays === false) {
      return `${weeklySummary} · Feriados: não entrega`;
    }
  }
  return weeklySummary;
}

export function enrichPharmacyApiRow(row: Record<string, unknown>): Record<string, unknown> {
  const commercial = parseCommercialTermsInput(row);
  const schedule = row.delivery_schedule;
  let delivery_open_now: boolean | null = null;
  if (hasCanonicalBusinessHours(schedule)) {
    delivery_open_now = isPharmacyDeliveryOpen(schedule, new Date());
  }
  return {
    ...row,
    commercial_terms: formatCommercialTermsPt(commercial),
    delivery_schedule_summary: formatDeliveryScheduleSummary(schedule),
    delivery_open_now,
  };
}
