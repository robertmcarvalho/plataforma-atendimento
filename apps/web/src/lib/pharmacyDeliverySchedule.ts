import {
  ensureBusinessHoursPayload,
  type BusinessHoursPayload,
  type HolidaySchedule,
} from '@/components/settings/BusinessHoursEditor';

export const PHARMACY_EXCEPTION_PREFIX = 'EXC:';

export type HolidayDeliverySchedule = {
  is_open: boolean;
  intervals: Array<{ start: string; end: string }>;
};

export type PharmacyDeliveryScheduleExtras = {
  deliver_on_holidays?: boolean;
  holiday_delivery?: HolidayDeliverySchedule;
};

const DEFAULT_START = '08:00';
const DEFAULT_END = '18:00';

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
        intervals: openLegacy.intervals.map((i) => ({
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

/** Carrega JSON da API para o editor (migra feriados legados, mantém só exceções em holidays). */
export function parsePharmacyDeliveryScheduleForEdit(raw: unknown): Record<string, unknown> {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const cfg = ensureBusinessHoursPayload(o);
  const exceptions = cfg.holidays.filter(isExceptionHoliday);

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
    holidays: exceptions,
    deliver_on_holidays,
    holiday_delivery,
  };
}

export function validatePharmacyDeliverySchedule(raw: Record<string, unknown>): string | null {
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
    holidays: cfg.holidays.filter(isExceptionHoliday),
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
