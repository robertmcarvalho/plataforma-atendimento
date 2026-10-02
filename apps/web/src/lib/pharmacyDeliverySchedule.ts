import {
  ensureBusinessHoursPayload,
  type BusinessHoursPayload,
  type HolidaySchedule,
  type Weekday,
} from '@/components/settings/BusinessHoursEditor';
import { isValidBusinessInterval } from '@/lib/businessHoursInterval';

export const PHARMACY_EXCEPTION_PREFIX = 'EXC:';

export type HolidayDeliverySchedule = {
  is_open: boolean;
  intervals: Array<{ start: string; end: string }>;
};

export type PharmacyDeliveryScheduleExtras = {
  deliver_on_holidays?: boolean;
  holiday_delivery?: HolidayDeliverySchedule;
};

type DaySchedule = {
  is_open: boolean;
  intervals: Array<{ start: string; end: string }>;
};

const DEFAULT_START = '08:00';
const DEFAULT_END = '18:00';

const WEEKDAY_LABELS: Record<Weekday, string> = {
  monday: 'Segunda',
  tuesday: 'Terça',
  wednesday: 'Quarta',
  thursday: 'Quinta',
  friday: 'Sexta',
  saturday: 'Sábado',
  sunday: 'Domingo',
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

function clampTime(value: string, fallback: string) {
  const v = String(value || '').trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(v) ? v : fallback;
}

function isExceptionHoliday(h: HolidaySchedule): boolean {
  return (
    h.is_open !== false &&
    (h.intervals?.length || 0) > 0 &&
    String(h.name || '').startsWith(PHARMACY_EXCEPTION_PREFIX)
  );
}

function isNamedHoliday(h: HolidaySchedule): boolean {
  const name = String(h.name || '').trim();
  return Boolean(h.date) && !name.startsWith(PHARMACY_EXCEPTION_PREFIX);
}

function legacyHolidayRows(holidays: HolidaySchedule[]): HolidaySchedule[] {
  return holidays.filter((h) => !isExceptionHoliday(h));
}

function migrateFromLegacyHolidays(holidays: HolidaySchedule[]): {
  deliver_on_holidays: boolean;
  holiday_delivery: HolidayDeliverySchedule;
} {
  const legacy = legacyHolidayRows(holidays);
  const openLegacy = legacy.find((h) => h.is_open !== false && (h.intervals?.length || 0) > 0);
  if (openLegacy?.intervals?.length) {
    return {
      deliver_on_holidays: true,
      holiday_delivery: {
        is_open: true,
        intervals: openLegacy.intervals.map((i: { start: string; end: string }) => ({
          start: clampTime(i.start, DEFAULT_START),
          end: clampTime(i.end, DEFAULT_END),
        })),
      },
    };
  }
  return {
    deliver_on_holidays: false,
    holiday_delivery: { is_open: false, intervals: [] },
  };
}

function closedDay(): DaySchedule {
  return { is_open: false, intervals: [] };
}

function openDay(start: string, end: string): DaySchedule {
  return { is_open: true, intervals: [{ start, end }] };
}

const LEAD_DEFAULT_SAT_END = '14:00';
const LEAD_DEFAULT_HOLIDAY_START = '10:00';
const LEAD_DEFAULT_HOLIDAY_END = '16:00';

/** Converte horários flat da ficha do lead em delivery_schedule canônico da farmácia. */
export function deliveryScheduleFromLeadCustomFields(
  custom: Record<string, string | number | boolean> | undefined | null,
): Record<string, unknown> | null {
  if (!custom || custom.delivery_hours_informed !== true) return null;

  const segSex = custom.delivery_seg_sex !== false;
  const sabado = custom.delivery_sabado !== false;
  const domingo = custom.delivery_domingo === true;
  const feriados = custom.delivery_feriados === true || custom.deliver_on_holidays === true;

  const segSexStart = clampTime(String(custom.horario_seg_sex_inicio || ''), DEFAULT_START);
  const segSexEnd = clampTime(String(custom.horario_seg_sex_fim || ''), DEFAULT_END);
  const sabStart = clampTime(String(custom.horario_sabado_inicio || ''), DEFAULT_START);
  const sabEnd = clampTime(String(custom.horario_sabado_fim || ''), LEAD_DEFAULT_SAT_END);
  const domStart = clampTime(String(custom.horario_domingo_inicio || ''), DEFAULT_START);
  const domEnd = clampTime(String(custom.horario_domingo_fim || ''), DEFAULT_END);
  const ferStart = clampTime(String(custom.horario_feriados_inicio || ''), LEAD_DEFAULT_HOLIDAY_START);
  const ferEnd = clampTime(String(custom.horario_feriados_fim || ''), LEAD_DEFAULT_HOLIDAY_END);

  const weekly: Record<Weekday, DaySchedule> = {
    monday: segSex ? openDay(segSexStart, segSexEnd) : closedDay(),
    tuesday: segSex ? openDay(segSexStart, segSexEnd) : closedDay(),
    wednesday: segSex ? openDay(segSexStart, segSexEnd) : closedDay(),
    thursday: segSex ? openDay(segSexStart, segSexEnd) : closedDay(),
    friday: segSex ? openDay(segSexStart, segSexEnd) : closedDay(),
    saturday: sabado ? openDay(sabStart, sabEnd) : closedDay(),
    sunday: domingo ? openDay(domStart, domEnd) : closedDay(),
  };

  const hasOpenWeekday = Object.values(weekly).some((d) => d.is_open);
  if (!hasOpenWeekday && !feriados) return null;

  return {
    timezone: 'America/Sao_Paulo',
    weekly,
    holidays: [],
    deliver_on_holidays: feriados,
    holiday_delivery: feriados
      ? { is_open: true, intervals: [{ start: ferStart, end: ferEnd }] }
      : { is_open: false, intervals: [] },
  };
}

/** Carrega JSON da API para o editor (migra feriados legados, mantém só exceções em holidays). */
export function parsePharmacyDeliveryScheduleForEdit(raw: unknown): Record<string, unknown> {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const cfg = ensureBusinessHoursPayload(o);
  const exceptions = cfg.holidays.filter(isExceptionHoliday);
  const namedHolidays = cfg.holidays.filter(isNamedHoliday);

  let deliver_on_holidays = o.deliver_on_holidays === true;
  let holiday_delivery: HolidayDeliverySchedule = {
    is_open: false,
    intervals: [],
  };

  if (o.holiday_delivery && typeof o.holiday_delivery === 'object') {
    const hd = o.holiday_delivery as Record<string, unknown>;
    const intervals = Array.isArray(hd.intervals)
      ? (hd.intervals as unknown[])
          .map((iv) => {
            if (!iv || typeof iv !== 'object') return null;
            const x = iv as Record<string, unknown>;
            const start = clampTime(String(x.start || ''), DEFAULT_START);
            const end = clampTime(String(x.end || ''), DEFAULT_END);
            return { start, end };
          })
          .filter(Boolean) as Array<{ start: string; end: string }>
      : [];
    holiday_delivery = {
      is_open: hd.is_open !== false && intervals.length > 0,
      intervals,
    };
    if (o.deliver_on_holidays === undefined) {
      deliver_on_holidays = holiday_delivery.is_open;
    }
  } else if (o.deliver_on_holidays === undefined && legacyHolidayRows(cfg.holidays).length > 0) {
    const migrated = migrateFromLegacyHolidays(cfg.holidays);
    deliver_on_holidays = migrated.deliver_on_holidays;
    holiday_delivery = migrated.holiday_delivery;
  }

  if (deliver_on_holidays && !holiday_delivery.intervals.length) {
    holiday_delivery = { is_open: true, intervals: [{ start: DEFAULT_START, end: DEFAULT_END }] };
  }

  return {
    timezone: cfg.timezone,
    weekly: cfg.weekly,
    holidays: [...namedHolidays, ...exceptions],
    deliver_on_holidays,
    holiday_delivery,
  };
}

function validateWeeklyDeliveryIntervals(cfg: BusinessHoursPayload): string | null {
  let anyOpenDay = false;
  let anyValidInterval = false;

  for (const dayKey of WEEKDAY_ORDER) {
    const day = cfg.weekly[dayKey];
    if (!day?.is_open) continue;
    anyOpenDay = true;
    const intervals = day.intervals?.length ? day.intervals : [{ start: DEFAULT_START, end: DEFAULT_END }];
    for (const iv of intervals) {
      if (!isValidBusinessInterval(iv.start, iv.end)) {
        return `Horário inválido (${WEEKDAY_LABELS[dayKey]}): use término 00:00 para fechar à meia-noite (ex.: 09:00 às 00:00).`;
      }
      anyValidInterval = true;
    }
  }

  if (anyOpenDay && !anyValidInterval) {
    return 'Configure pelo menos um dia com horário de delivery válido.';
  }
  return null;
}

export function validatePharmacyDeliverySchedule(raw: Record<string, unknown>): string | null {
  const cfg = ensureBusinessHoursPayload(raw);
  const weeklyErr = validateWeeklyDeliveryIntervals(cfg);
  if (weeklyErr) return weeklyErr;

  if (raw.deliver_on_holidays !== true) return null;
  const hd = raw.holiday_delivery;
  if (!hd || typeof hd !== 'object') {
    return 'Informe o horário de entrega em feriados ou desative a entrega em feriados.';
  }
  const o = hd as Record<string, unknown>;
  const intervals = Array.isArray(o.intervals) ? o.intervals : [];
  const valid = intervals.filter((iv) => {
    if (!iv || typeof iv !== 'object') return false;
    const x = iv as Record<string, unknown>;
    return /^\d{2}:\d{2}$/.test(String(x.start || '')) && /^\d{2}:\d{2}$/.test(String(x.end || ''));
  });
  if (!valid.length) {
    return 'Informe pelo menos um intervalo válido para entrega em feriados (início e fim).';
  }
  return null;
}

export function serializePharmacyDeliveryScheduleForApi(raw: Record<string, unknown> | undefined): Record<string, unknown> {
  const parsed = parsePharmacyDeliveryScheduleForEdit(raw);
  const err = validatePharmacyDeliverySchedule(parsed);
  if (err) throw new Error(err);

  const cfg = ensureBusinessHoursPayload(parsed);
  const base = JSON.parse(JSON.stringify({
    timezone: cfg.timezone,
    weekly: cfg.weekly,
    holidays: cfg.holidays.filter((h) => isExceptionHoliday(h) || isNamedHoliday(h)),
  })) as Record<string, unknown>;

  base.deliver_on_holidays = parsed.deliver_on_holidays === true;
  if (base.deliver_on_holidays) {
    const hd = parsed.holiday_delivery as HolidayDeliverySchedule;
    base.holiday_delivery = {
      is_open: true,
      intervals: (hd?.intervals || []).map((i) => ({
        start: clampTime(i.start, DEFAULT_START),
        end: clampTime(i.end, DEFAULT_END),
      })),
    };
  } else {
    base.holiday_delivery = { is_open: false, intervals: [] };
  }

  return base;
}

export function getPharmacyDeliveryExtras(raw: unknown): PharmacyDeliveryScheduleExtras {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  return {
    deliver_on_holidays: o.deliver_on_holidays === true,
    holiday_delivery:
      o.holiday_delivery && typeof o.holiday_delivery === 'object'
        ? (o.holiday_delivery as HolidayDeliverySchedule)
        : undefined,
  };
}

export function mergePharmacySchedulePatch(
  value: Record<string, unknown>,
  patch: Partial<PharmacyDeliveryScheduleExtras> & Partial<BusinessHoursPayload>
): Record<string, unknown> {
  return { ...parsePharmacyDeliveryScheduleForEdit(value), ...patch };
}
