/**
 * Horário comercial canônico (timezone + weekly + holidays).
 * Sem dependências — usa Intl para interpretar instantes no fuso configurado.
 */

export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export type BusinessHoursInterval = { start: string; end: string };

export type DaySchedule = {
  is_open: boolean;
  intervals: BusinessHoursInterval[];
};

export type HolidaySchedule = {
  date: string;
  is_open: boolean;
  intervals?: BusinessHoursInterval[];
  name?: string;
};

export type BusinessHoursConfig = {
  timezone: string;
  weekly: Record<Weekday, DaySchedule>;
  holidays: HolidaySchedule[];
};

const WEEKDAYS: Weekday[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const WEEKDAY_FROM_LONG: Record<string, Weekday> = {
  Monday: 'monday',
  Tuesday: 'tuesday',
  Wednesday: 'wednesday',
  Thursday: 'thursday',
  Friday: 'friday',
  Saturday: 'saturday',
  Sunday: 'sunday',
};

const LEGACY_PT: Record<string, Weekday> = {
  seg: 'monday',
  ter: 'tuesday',
  qua: 'wednesday',
  qui: 'thursday',
  sex: 'friday',
  sab: 'saturday',
  dom: 'sunday',
};

function closedDay(): DaySchedule {
  return { is_open: false, intervals: [] };
}

function defaultWeekly(): Record<Weekday, DaySchedule> {
  const w = {} as Record<Weekday, DaySchedule>;
  for (const d of WEEKDAYS) w[d] = closedDay();
  return w;
}

/** Config vazia ou sem weekly → não restringe SLA / considerado “sempre aberto” para cálculo. */
export function hasCanonicalBusinessHours(raw: unknown): raw is BusinessHoursConfig {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  const weekly = o.weekly;
  if (!weekly || typeof weekly !== 'object') return false;
  return WEEKDAYS.some((d) => d in (weekly as object));
}

export function normalizeBusinessHours(raw: unknown, fallbackTz = 'America/Sao_Paulo'): BusinessHoursConfig {
  if (hasCanonicalBusinessHours(raw)) {
    const o = raw as BusinessHoursConfig;
    const weekly = { ...defaultWeekly() };
    for (const d of WEEKDAYS) {
      const day = (o.weekly as Record<string, unknown>)[d];
      weekly[d] = normalizeDay(day);
    }
    const holidays = Array.isArray(o.holidays)
      ? (o.holidays as unknown[]).map(normalizeHoliday).filter((h): h is HolidaySchedule => Boolean(h))
      : [];
    return {
      timezone: typeof o.timezone === 'string' && o.timezone.trim() ? o.timezone.trim() : fallbackTz,
      weekly,
      holidays,
    };
  }

  if (raw && typeof raw === 'object' && !('weekly' in (raw as object))) {
    const o = raw as Record<string, unknown>;
    const weekly = { ...defaultWeekly() };
    for (const [k, wd] of Object.entries(LEGACY_PT)) {
      const dayJson = o[k];
      weekly[wd] = legacyPtDayToSchedule(dayJson);
    }
    for (const d of WEEKDAYS) {
      if (o[d]) weekly[d] = legacyPtDayToSchedule(o[d]);
    }
    return {
      timezone: typeof o.timezone === 'string' && o.timezone.trim() ? String(o.timezone) : fallbackTz,
      weekly,
      holidays: Array.isArray(o.holidays)
        ? (o.holidays as unknown[]).map(normalizeHoliday).filter((h): h is HolidaySchedule => Boolean(h))
        : [],
    };
  }

  return {
    timezone: fallbackTz,
    weekly: defaultWeekly(),
    holidays: [],
  };
}

function parseIntervalPair(startRaw: unknown, endRaw: unknown): BusinessHoursInterval | null {
  const start = String(startRaw || '').trim();
  const end = String(endRaw || '').trim();
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return null;
  return { start, end };
}

function intervalsFromDayObject(o: Record<string, unknown>): BusinessHoursInterval[] {
  if (Array.isArray(o.intervals)) {
    const parsed = (o.intervals as unknown[])
      .map((iv) => {
        if (!iv || typeof iv !== 'object') return null;
        const x = iv as Record<string, unknown>;
        return parseIntervalPair(x.start, x.end);
      })
      .filter(Boolean) as BusinessHoursInterval[];
    if (parsed.length) return parsed;
  }
  const flat = parseIntervalPair(o.start ?? o.inicio, o.end ?? o.fim);
  return flat ? [flat] : [];
}

function normalizeDay(day: unknown): DaySchedule {
  if (!day || typeof day !== 'object') return closedDay();
  const o = day as Record<string, unknown>;
  const isOpen = o.is_open !== false && o.ativo !== false;
  const intervals = intervalsFromDayObject(o);
  if (!isOpen || intervals.length === 0) return { is_open: false, intervals: [] };
  return { is_open: true, intervals: mergeIntervals(intervals) };
}

function normalizeHoliday(h: unknown): HolidaySchedule | null {
  if (!h || typeof h !== 'object') return null;
  const o = h as Record<string, unknown>;
  const date = String(o.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const isOpen = o.is_open !== false;
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
        .filter(Boolean) as BusinessHoursInterval[]
    : [];
  return {
    date,
    is_open: isOpen,
    intervals: isOpen ? mergeIntervals(intervals) : [],
    name: o.name ? String(o.name) : undefined,
  };
}

function legacyPtDayToSchedule(dayJson: unknown): DaySchedule {
  if (!dayJson || typeof dayJson !== 'object') return closedDay();
  const o = dayJson as Record<string, unknown>;
  if (o.is_open === false) return closedDay();
  const start = String(o.start || '').trim();
  const end = String(o.end || '').trim();
  if (/^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end)) {
    return { is_open: true, intervals: [{ start, end }] };
  }
  return closedDay();
}

function parseHM(s: string): number {
  const [h, m] = s.split(':').map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

/** Fim exclusivo em minutos. `00:00` após início diurno = meia-noite (24:00). */
function endMinutesExclusive(end: string, start: string): number {
  const sm = parseHM(start);
  if (end === '00:00' && sm > 0) return 24 * 60;
  return parseHM(end);
}

export function isValidBusinessInterval(start: string, end: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return false;
  const sm = parseHM(start);
  const em = parseHM(end);
  if (end === '00:00' && sm > 0) return true;
  if (em > sm) return true;
  if (em < sm) return true;
  return false;
}

export function isMinuteWithinBusinessInterval(cur: number, start: string, end: string): boolean {
  const sm = parseHM(start);
  const emEx = endMinutesExclusive(end, start);
  if (end === '00:00' && sm > 0) return cur >= sm && cur < emEx;
  const em = parseHM(end);
  if (em > sm) return cur >= sm && cur < em;
  return cur >= sm || cur < em;
}

function mergeIntervals(intervals: BusinessHoursInterval[]): BusinessHoursInterval[] {
  const sorted = [...intervals].sort((a, b) => parseHM(a.start) - parseHM(b.start));
  const out: BusinessHoursInterval[] = [];
  for (const iv of sorted) {
    if (!isValidBusinessInterval(iv.start, iv.end)) continue;
    const sm = parseHM(iv.start);
    const emEx = endMinutesExclusive(iv.end, iv.start);
    if (!out.length) {
      out.push({ ...iv });
      continue;
    }
    const last = out[out.length - 1]!;
    const lemEx = endMinutesExclusive(last.end, last.start);
    if (sm <= lemEx) {
      if (emEx > lemEx) last.end = iv.end;
    } else {
      out.push({ ...iv });
    }
  }
  return out;
}

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekdayLong: string;
};

export function getPartsInTimeZone(date: Date, timeZone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'long',
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const hour = Number(map.hour);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    weekdayLong: map.weekday || 'Monday',
  };
}

function ymdFromParts(p: ZonedParts): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function weekdayKeyFromParts(p: ZonedParts): Weekday {
  return WEEKDAY_FROM_LONG[p.weekdayLong] || 'monday';
}

/** Converte instante de parede local (y,m,d,H,M) no fuso `tz` para UTC Date. */
export function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string
): Date {
  function wallDeltaMinutes(
    y: number,
    mo: number,
    d: number,
    h: number,
    mi: number,
    py: number,
    pm: number,
    pd: number,
    ph: number,
    pmi: number
  ): number {
    const ord = (Y: number, M: number, D: number) =>
      Math.floor(Date.UTC(Y, M - 1, D) / 86400000);
    return (ord(y, mo, d) - ord(py, pm, pd)) * 24 * 60 + (h * 60 + mi) - (ph * 60 + pmi);
  }

  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  for (let i = 0; i < 48; i++) {
    const p = getPartsInTimeZone(new Date(utcMs), tz);
    const dm = wallDeltaMinutes(year, month, day, hour, minute, p.year, p.month, p.day, p.hour, p.minute);
    if (dm === 0) return new Date(utcMs);
    utcMs += dm * 60 * 1000;
  }
  return new Date(utcMs);
}

function scheduleForYmd(config: BusinessHoursConfig, ymd: string, weekday: Weekday): DaySchedule {
  const hol = config.holidays.find((h) => h.date === ymd);
  if (hol) {
    if (!hol.is_open || !hol.intervals?.length) return closedDay();
    return { is_open: true, intervals: mergeIntervals(hol.intervals) };
  }
  return normalizeDay(config.weekly[weekday]);
}

export function intervalsForZonedInstant(config: BusinessHoursConfig, date: Date): {
  ymd: string;
  weekday: Weekday;
  daySchedule: DaySchedule;
} {
  const tz = config.timezone || 'America/Sao_Paulo';
  const parts = getPartsInTimeZone(date, tz);
  const ymd = ymdFromParts(parts);
  const weekday = weekdayKeyFromParts(parts);
  const daySchedule = scheduleForYmd(config, ymd, weekday);
  return { ymd, weekday, daySchedule };
}

export function isOpen(config: BusinessHoursConfig | null | undefined, date: Date): boolean {
  if (!config || !hasCanonicalBusinessHours(config)) return true;
  const c = normalizeBusinessHours(config);
  const tz = c.timezone;
  const parts = getPartsInTimeZone(date, tz);
  const ymd = ymdFromParts(parts);
  const weekday = weekdayKeyFromParts(parts);
  const day = scheduleForYmd(c, ymd, weekday);
  if (!day.is_open || day.intervals.length === 0) return false;
  const cur = parts.hour * 60 + parts.minute;
  for (const iv of day.intervals) {
    if (isMinuteWithinBusinessInterval(cur, iv.start, iv.end)) return true;
  }
  return false;
}

export function formatNextOpenHuman(config: BusinessHoursConfig, next: Date, locale = 'pt-BR'): string {
  try {
    const tz = config.timezone;
    const weekday = new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'long' }).format(next);
    const day = new Intl.DateTimeFormat(locale, { timeZone: tz, day: 'numeric' }).format(next);
    const month = new Intl.DateTimeFormat(locale, { timeZone: tz, month: 'long' }).format(next);
    const parts = new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(next);
    const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
    const timeLabel = minute === '00' ? `${hour}h00` : `${hour}h${minute}`;
    return `${weekday}, ${day} de ${month}, às ${timeLabel}`;
  } catch {
    return next.toISOString();
  }
}

/** Próximo instante >= fromUtc em que o setor/atendente está aberto. */
export function nextOpenAt(config: BusinessHoursConfig | null | undefined, fromUtc: Date): Date {
  if (!config || !hasCanonicalBusinessHours(config)) return new Date(fromUtc);
  const c = normalizeBusinessHours(config);
  const tz = c.timezone;
  let t = new Date(fromUtc.getTime());

  for (let guard = 0; guard < 5000; guard++) {
    if (isOpen(c, t)) return t;

    const parts = getPartsInTimeZone(t, tz);
    const ymd = ymdFromParts(parts);
    const weekday = weekdayKeyFromParts(parts);
    const daySched = scheduleForYmd(c, ymd, weekday);
    const curMin = parts.hour * 60 + parts.minute;

    if (daySched.is_open && daySched.intervals.length > 0) {
      const sorted = [...daySched.intervals].sort((a, b) => parseHM(a.start) - parseHM(b.start));
      for (const iv of sorted) {
        if (!isValidBusinessInterval(iv.start, iv.end)) continue;
        const sm = parseHM(iv.start);
        if (curMin < sm) {
          return zonedLocalToUtc(parts.year, parts.month, parts.day, Math.floor(sm / 60), sm % 60, tz);
        }
        if (isMinuteWithinBusinessInterval(curMin, iv.start, iv.end)) {
          return t;
        }
      }
    }

    const noon = zonedLocalToUtc(parts.year, parts.month, parts.day, 12, 0, tz);
    const tomorrowProbe = new Date(noon.getTime() + 25 * 3600000);
    const p2 = getPartsInTimeZone(tomorrowProbe, tz);
    t = zonedLocalToUtc(p2.year, p2.month, p2.day, 0, 0, tz);
  }

  return new Date(fromUtc.getTime() + 60000);
}

export function slaEffectiveStart(config: BusinessHoursConfig | null | undefined, fromUtc: Date): Date {
  if (!config || !hasCanonicalBusinessHours(config)) return new Date(fromUtc);
  const c = normalizeBusinessHours(config);
  if (isOpen(c, fromUtc)) return new Date(fromUtc);
  return nextOpenAt(c, fromUtc);
}

export function addBusinessMinutes(
  config: BusinessHoursConfig | null | undefined,
  fromUtc: Date,
  minutes: number
): Date {
  if (minutes <= 0) return new Date(fromUtc);
  if (!config || !hasCanonicalBusinessHours(config)) {
    return new Date(fromUtc.getTime() + minutes * 60000);
  }
  const c = normalizeBusinessHours(config);
  let cursor = slaEffectiveStart(c, fromUtc);
  let remaining = minutes;

  for (let guard = 0; guard < 200000 && remaining > 0; guard++) {
    if (!isOpen(c, cursor)) {
      cursor = nextOpenAt(c, new Date(cursor.getTime() + 60000));
      continue;
    }

    const parts = getPartsInTimeZone(cursor, c.timezone);
    const ymd = ymdFromParts(parts);
    const weekday = weekdayKeyFromParts(parts);
    const daySched = scheduleForYmd(c, ymd, weekday);
    if (!daySched.is_open || !daySched.intervals.length) {
      cursor = nextOpenAt(c, new Date(cursor.getTime() + 60000));
      continue;
    }

    const curMin = parts.hour * 60 + parts.minute;
    const sorted = [...daySched.intervals].sort((a, b) => parseHM(a.start) - parseHM(b.start));

    let advanced = false;
    for (const iv of sorted) {
      if (!isValidBusinessInterval(iv.start, iv.end)) continue;
      const sm = parseHM(iv.start);
      const emEx = endMinutesExclusive(iv.end, iv.start);

      if (curMin < sm) {
        cursor = zonedLocalToUtc(parts.year, parts.month, parts.day, Math.floor(sm / 60), sm % 60, c.timezone);
        advanced = true;
        break;
      }

      if (isMinuteWithinBusinessInterval(curMin, iv.start, iv.end)) {
        const left = emEx - curMin;
        const take = Math.min(remaining, left);
        remaining -= take;
        cursor = new Date(cursor.getTime() + take * 60000);
        advanced = true;
        break;
      }
    }

    if (!advanced) {
      const y = parts.year;
      const mo = parts.month;
      const d = parts.day;
      const noon = zonedLocalToUtc(y, mo, d, 12, 0, c.timezone);
      const tomorrowProbe = new Date(noon.getTime() + 25 * 3600000);
      const p2 = getPartsInTimeZone(tomorrowProbe, c.timezone);
      cursor = nextOpenAt(c, zonedLocalToUtc(p2.year, p2.month, p2.day, 0, 0, c.timezone));
    }
  }

  return cursor;
}

/** Soma N dias em que o setor está aberto (expediente canônico). */
export function addBusinessDays(
  config: BusinessHoursConfig | null | undefined,
  fromUtc: Date,
  days: number
): Date {
  if (days <= 0) return new Date(fromUtc);
  if (!config || !hasCanonicalBusinessHours(config)) {
    let cursor = new Date(fromUtc);
    let counted = 0;
    for (let guard = 0; guard < 400 && counted < days; guard++) {
      cursor = new Date(cursor.getTime() + 86400000);
      const dow = cursor.getUTCDay();
      if (dow !== 0 && dow !== 6) counted++;
    }
    return cursor;
  }
  const c = normalizeBusinessHours(config);
  let cursor = slaEffectiveStart(c, fromUtc);
  let counted = 0;
  for (let guard = 0; guard < 400 && counted < days; guard++) {
    const probe = new Date(cursor.getTime() + 86400000);
    const parts = getPartsInTimeZone(probe, c.timezone);
    const dayStart = zonedLocalToUtc(parts.year, parts.month, parts.day, 12, 0, c.timezone);
    const ymd = ymdFromParts(getPartsInTimeZone(dayStart, c.timezone));
    const weekday = weekdayKeyFromParts(getPartsInTimeZone(dayStart, c.timezone));
    const daySched = scheduleForYmd(c, ymd, weekday);
    if (daySched.is_open && daySched.intervals.length) {
      counted++;
      cursor = nextOpenAt(c, dayStart);
    } else {
      cursor = probe;
    }
  }
  return cursor;
}

export function todayIntervalsForApi(config: BusinessHoursConfig | null | undefined, date = new Date()) {
  if (!config || !hasCanonicalBusinessHours(config)) {
    return [] as { start: string; end: string }[];
  }
  const c = normalizeBusinessHours(config);
  const parts = getPartsInTimeZone(date, c.timezone);
  const ymd = ymdFromParts(parts);
  const weekday = weekdayKeyFromParts(parts);
  const daySched = scheduleForYmd(c, ymd, weekday);
  return daySched.intervals || [];
}
