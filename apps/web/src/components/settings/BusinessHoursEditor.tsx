'use client';

import { useMemo, useState } from 'react';
import { formatDateBr } from '@/lib/datetimeBr';

export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

type BusinessHoursInterval = { start: string; end: string };

type DaySchedule = {
  is_open: boolean;
  intervals: BusinessHoursInterval[];
};

type HolidaySchedule = {
  date: string;
  is_open: boolean;
  intervals: BusinessHoursInterval[];
  name?: string;
};

export type BusinessHoursPayload = {
  timezone: string;
  weekly: Record<Weekday, DaySchedule>;
  holidays: HolidaySchedule[];
};

const WEEKDAY_META: { key: Weekday; label: string }[] = [
  { key: 'monday', label: 'Segunda' },
  { key: 'tuesday', label: 'Terça' },
  { key: 'wednesday', label: 'Quarta' },
  { key: 'thursday', label: 'Quinta' },
  { key: 'friday', label: 'Sexta' },
  { key: 'saturday', label: 'Sábado' },
  { key: 'sunday', label: 'Domingo' },
];

const WEEKDAYS = WEEKDAY_META.map((w) => w.key);

function closedDay(): DaySchedule {
  return { is_open: false, intervals: [] };
}

function defaultWeekly(): Record<Weekday, DaySchedule> {
  const w = {} as Record<Weekday, DaySchedule>;
  for (const d of WEEKDAYS) w[d] = closedDay();
  return w;
}

function parseDay(raw: unknown): DaySchedule {
  if (!raw || typeof raw !== 'object') return closedDay();
  const o = raw as Record<string, unknown>;
  const open = o.is_open !== false;
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
  if (!open || intervals.length === 0) return closedDay();
  return { is_open: true, intervals };
}

function parseHoliday(raw: unknown): HolidaySchedule | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const date = String(o.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const open = o.is_open !== false;
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
  if (!open) {
    return { date, is_open: false, intervals: [], name: typeof o.name === 'string' ? o.name : undefined };
  }
  return {
    date,
    is_open: true,
    intervals: intervals.length ? intervals : [{ start: '09:00', end: '18:00' }],
    name: typeof o.name === 'string' ? o.name : undefined,
  };
}

/** Monta payload editável a partir do JSON salvo (canônico ou legado vazio). */
export function ensureBusinessHoursPayload(raw: unknown, fallbackTz = 'America/Sao_Paulo'): BusinessHoursPayload {
  const base: BusinessHoursPayload = {
    timezone: fallbackTz,
    weekly: defaultWeekly(),
    holidays: [],
  };

  if (!raw || typeof raw !== 'object') return base;

  const o = raw as Record<string, unknown>;

  if (typeof o.timezone === 'string' && o.timezone.trim()) {
    base.timezone = o.timezone.trim();
  }

  if (o.weekly && typeof o.weekly === 'object') {
    const w = o.weekly as Record<string, unknown>;
    for (const d of WEEKDAYS) {
      if (w[d] !== undefined) base.weekly[d] = parseDay(w[d]);
    }
  }

  const legacyPt: Record<string, Weekday> = {
    seg: 'monday',
    ter: 'tuesday',
    qua: 'wednesday',
    qui: 'thursday',
    sex: 'friday',
    sab: 'saturday',
    dom: 'sunday',
  };
  for (const [k, wd] of Object.entries(legacyPt)) {
    if (o[k] !== undefined && base.weekly[wd].is_open === false && !base.weekly[wd].intervals.length) {
      const legacy = o[k];
      if (legacy && typeof legacy === 'object' && 'start' in (legacy as object) && 'end' in (legacy as object)) {
        const L = legacy as { start?: string; end?: string };
        const start = String(L.start || '09:00').slice(0, 5);
        const end = String(L.end || '18:00').slice(0, 5);
        if (/^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end)) {
          base.weekly[wd] = { is_open: true, intervals: [{ start, end }] };
        }
      }
    }
  }

  if (Array.isArray(o.holidays)) {
    base.holidays = (o.holidays as unknown[]).map(parseHoliday).filter((h): h is HolidaySchedule => Boolean(h));
  }

  return base;
}

const COMMON_TZ = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Fortaleza',
  'America/Belem',
  'America/Recife',
  'America/Bahia',
  'UTC',
];

function payloadToJson(cfg: BusinessHoursPayload): Record<string, unknown> {
  return {
    timezone: cfg.timezone,
    weekly: cfg.weekly,
    holidays: cfg.holidays,
  };
}

function dayIntervalsLabel(day: DaySchedule): string {
  if (!day.is_open || day.intervals.length === 0) return '';
  return day.intervals.map((i) => `${i.start}–${i.end}`).join(', ');
}

/** True if at least one weekday has opening intervals configured. */
export function hasConfiguredWorkSchedule(raw: unknown): boolean {
  const cfg = ensureBusinessHoursPayload(raw);
  return WEEKDAYS.some((d) => {
    const x = cfg.weekly[d];
    return x.is_open && x.intervals.length > 0;
  });
}

/** One-line summary for lists (e.g. pharmacy team). */
export function formatWorkScheduleSummary(raw: unknown): string {
  const cfg = ensureBusinessHoursPayload(raw);
  const openDays = WEEKDAY_META.filter(({ key }) => {
    const x = cfg.weekly[key];
    return x.is_open && x.intervals.length > 0;
  });
  if (!openDays.length) return '';

  const labelShort = (k: Weekday) => WEEKDAY_META.find((w) => w.key === k)!.label.slice(0, 3);

  const parts: string[] = [];
  let i = 0;
  while (i < openDays.length) {
    const startKey = openDays[i].key;
    const sig = dayIntervalsLabel(cfg.weekly[startKey]);
    let j = i;
    while (
      j + 1 < openDays.length &&
      WEEKDAYS.indexOf(openDays[j + 1].key) === WEEKDAYS.indexOf(openDays[j].key) + 1 &&
      dayIntervalsLabel(cfg.weekly[openDays[j + 1].key]) === sig
    ) {
      j++;
    }
    const a = openDays[i].key;
    const b = openDays[j].key;
    const range = a === b ? labelShort(a) : `${labelShort(a)}–${labelShort(b)}`;
    parts.push(`${range} ${sig}`);
    i = j + 1;
  }
  return parts.join(' · ');
}

/** Canonical JSON for API (full weekly + deep plain object). */
export function serializeWorkScheduleForApi(raw: Record<string, unknown> | undefined): Record<string, unknown> {
  return JSON.parse(JSON.stringify(payloadToJson(ensureBusinessHoursPayload(raw)))) as Record<string, unknown>;
}

export function BusinessHoursEditor({
  value,
  onChange,
  disabled,
  readonly,
}: {
  value: Record<string, unknown> | undefined;
  onChange: (next: Record<string, unknown>) => void;
  disabled?: boolean;
  readonly?: boolean;
}) {
  const locked = Boolean(disabled || readonly);
  const cfg = useMemo(() => ensureBusinessHoursPayload(value), [value]);

  const push = (next: BusinessHoursPayload) => {
    onChange(payloadToJson(next));
  };

  const setTimezone = (timezone: string) => {
    push({ ...cfg, timezone });
  };

  const setDay = (day: Weekday, patch: Partial<DaySchedule>) => {
    const prev = cfg.weekly[day];
    push({
      ...cfg,
      weekly: { ...cfg.weekly, [day]: { ...prev, ...patch } },
    });
  };

  const setIntervalAt = (day: Weekday, index: number, patch: Partial<BusinessHoursInterval>) => {
    const intervals = [...cfg.weekly[day].intervals];
    const cur = intervals[index] || { start: '09:00', end: '18:00' };
    intervals[index] = { ...cur, ...patch };
    setDay(day, { intervals, is_open: true });
  };

  const addInterval = (day: Weekday) => {
    const intervals = [...cfg.weekly[day].intervals, { start: '09:00', end: '12:00' }];
    setDay(day, { is_open: true, intervals });
  };

  const removeInterval = (day: Weekday, index: number) => {
    const intervals = cfg.weekly[day].intervals.filter((_, i) => i !== index);
    setDay(day, { intervals, is_open: intervals.length > 0 });
  };

  const copyWeekdayToWeekdays = (from: Weekday) => {
    const src = cfg.weekly[from];
    const nextWeekly = { ...cfg.weekly };
    const targets: Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    for (const t of targets) {
      nextWeekly[t] = {
        is_open: src.is_open,
        intervals: src.intervals.map((i) => ({ ...i })),
      };
    }
    push({ ...cfg, weekly: nextWeekly });
  };

  const [holidayDraft, setHolidayDraft] = useState({ date: '', name: '' });

  const addHoliday = () => {
    const date = holidayDraft.date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    if (cfg.holidays.some((h) => h.date === date)) return;
    const next: HolidaySchedule = {
      date,
      is_open: false,
      intervals: [],
      name: holidayDraft.name.trim() || undefined,
    };
    push({ ...cfg, holidays: [...cfg.holidays, next] });
    setHolidayDraft({ date: '', name: '' });
  };

  const patchHoliday = (idx: number, patch: Partial<HolidaySchedule>) => {
    const holidays = cfg.holidays.map((h, i) => (i === idx ? { ...h, ...patch } : h));
    push({ ...cfg, holidays });
  };

  const removeHoliday = (idx: number) => {
    push({ ...cfg, holidays: cfg.holidays.filter((_, i) => i !== idx) });
  };

  return (
    <div className="grid gap-4">
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
          Fuso horário (IANA)
        </span>
        <input
          list="bh-common-tz"
          value={cfg.timezone}
          disabled={locked}
          onChange={(e) => setTimezone(e.target.value)}
          className="rounded-[1rem] border px-4 py-3 font-mono text-sm outline-none"
          style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--text)' }}
        />
        <datalist id="bh-common-tz">
          {COMMON_TZ.map((tz) => (
            <option key={tz} value={tz} />
          ))}
        </datalist>
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={locked}
          onClick={() => copyWeekdayToWeekdays('monday')}
          className="rounded-full border px-3 py-1.5 text-xs font-medium"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        >
          Copiar segunda → dias úteis
        </button>
      </div>

      <div className="grid gap-3">
        {WEEKDAY_META.map(({ key, label }) => {
          const day = cfg.weekly[key];
          return (
            <div
              key={key}
              className="rounded-[1rem] border p-4"
              style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text)' }}>
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={day.is_open}
                    onChange={(e) =>
                      setDay(key, e.target.checked ? { is_open: true, intervals: day.intervals.length ? day.intervals : [{ start: '09:00', end: '18:00' }] } : closedDay())
                    }
                  />
                  {label}
                </label>
                {day.is_open ? (
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => addInterval(key)}
                    className="text-xs font-medium"
                    style={{ color: 'var(--accent)' }}
                  >
                    + intervalo
                  </button>
                ) : null}
              </div>

              {day.is_open ? (
                <div className="flex flex-col gap-2">
                  {(day.intervals.length ? day.intervals : [{ start: '09:00', end: '18:00' }]).map((iv, idx) => (
                    <div key={`${key}-${idx}`} className="flex flex-wrap items-center gap-2">
                      <input
                        type="time"
                        disabled={locked}
                        value={iv.start}
                        onChange={(e) => setIntervalAt(key, idx, { start: e.target.value })}
                        className="rounded-lg border px-2 py-1.5 font-mono text-xs outline-none"
                        style={{ borderColor: 'var(--border)', background: 'var(--background)', color: 'var(--text)' }}
                      />
                      <span className="text-xs text-muted-foreground">até</span>
                      <input
                        type="time"
                        disabled={locked}
                        value={iv.end}
                        onChange={(e) => setIntervalAt(key, idx, { end: e.target.value })}
                        className="rounded-lg border px-2 py-1.5 font-mono text-xs outline-none"
                        style={{ borderColor: 'var(--border)', background: 'var(--background)', color: 'var(--text)' }}
                      />
                      <button
                        type="button"
                        disabled={locked || day.intervals.length <= 1}
                        onClick={() => removeInterval(key, idx)}
                        className="ml-auto text-xs"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        remover
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Fechado neste dia.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold" style={{ color: 'var(--text)' }}>
          Feriados e exceções
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          <input
            type="date"
            lang="pt-BR"
            disabled={locked}
            value={holidayDraft.date}
            onChange={(e) => setHolidayDraft((p) => ({ ...p, date: e.target.value }))}
            className="rounded-[1rem] border px-3 py-2 text-sm outline-none"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}
          />
          <input
            placeholder="Nome (opcional)"
            disabled={locked}
            value={holidayDraft.name}
            onChange={(e) => setHolidayDraft((p) => ({ ...p, name: e.target.value }))}
            className="min-w-[160px] flex-1 rounded-[1rem] border px-3 py-2 text-sm outline-none"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-2)', color: 'var(--text)' }}
          />
          <button
            type="button"
            disabled={locked}
            onClick={() => addHoliday()}
            className="rounded-[1rem] px-4 py-2 text-sm font-semibold"
            style={{ background: 'var(--surface-hover)', color: 'var(--text)' }}
          >
            Adicionar data
          </button>
        </div>

        <div className="grid gap-2">
          {cfg.holidays.map((h, idx) => (
            <div
              key={`${h.date}-${idx}`}
              className="flex flex-col gap-2 rounded-[1rem] border p-3 sm:flex-row sm:items-center"
              style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
            >
              <div className="min-w-[120px] font-mono text-sm">{formatDateBr(h.date)}</div>
              <div className="flex-1 text-sm">{h.name || '—'}</div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={h.is_open}
                  onChange={(e) =>
                    patchHoliday(idx, e.target.checked ? { is_open: true, intervals: h.intervals.length ? h.intervals : [{ start: '09:00', end: '13:00' }] } : { is_open: false, intervals: [] })
                  }
                />
                Abre com horário especial
              </label>
              <button type="button" disabled={locked} onClick={() => removeHoliday(idx)} className="text-xs" style={{ color: 'rgb(185, 28, 28)' }}>
                excluir
              </button>
              {h.is_open ? (
                <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                  {(h.intervals.length ? h.intervals : [{ start: '09:00', end: '13:00' }]).map((iv, j) => (
                    <div key={j} className="flex items-center gap-1">
                      <input
                        type="time"
                        disabled={locked}
                        value={iv.start}
                        onChange={(e) => {
                          const intervals = [...(h.intervals.length ? h.intervals : [{ start: '09:00', end: '13:00' }])];
                          intervals[j] = { ...intervals[j], start: e.target.value };
                          patchHoliday(idx, { intervals });
                        }}
                        className="rounded border px-1 py-1 font-mono text-xs"
                        style={{ borderColor: 'var(--border)' }}
                      />
                      <span className="text-[10px] text-muted-foreground">—</span>
                      <input
                        type="time"
                        disabled={locked}
                        value={iv.end}
                        onChange={(e) => {
                          const intervals = [...(h.intervals.length ? h.intervals : [{ start: '09:00', end: '13:00' }])];
                          intervals[j] = { ...intervals[j], end: e.target.value };
                          patchHoliday(idx, { intervals });
                        }}
                        className="rounded border px-1 py-1 font-mono text-xs"
                        style={{ borderColor: 'var(--border)' }}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {!cfg.holidays.length ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Nenhuma data cadastrada.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
