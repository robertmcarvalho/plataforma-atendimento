'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/Switch';
import {
  ensureBusinessHoursPayload,
  type BusinessHoursPayload,
  type Weekday,
} from '@/components/settings/BusinessHoursEditor';
import {
  PHARMACY_EXCEPTION_PREFIX,
  parsePharmacyDeliveryScheduleForEdit,
  type HolidayDeliverySchedule,
} from '@/lib/pharmacyDeliverySchedule';

type JsonObj = Record<string, unknown>;

type Props = {
  value: JsonObj | undefined;
  onChange: (next: JsonObj) => void;
  disabled?: boolean;
};

const DAYS: { label: string; key: Weekday }[] = [
  { label: 'Seg', key: 'monday' },
  { label: 'Ter', key: 'tuesday' },
  { label: 'Qua', key: 'wednesday' },
  { label: 'Qui', key: 'thursday' },
  { label: 'Sex', key: 'friday' },
  { label: 'Sáb', key: 'saturday' },
  { label: 'Dom', key: 'sunday' },
];

const DEFAULT_START = '08:00';
const DEFAULT_END = '18:00';

function clampTime(value: string, fallback: string) {
  const v = String(value || '').trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(v) ? v : fallback;
}

function sortByDateAsc<T extends { date: string }>(rows: T[]) {
  return [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

type DraftException = { id: string; date: string; name: string; start: string; end: string };

function draftId(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function defaultHolidayDelivery(): HolidayDeliverySchedule {
  return { is_open: true, intervals: [{ start: DEFAULT_START, end: DEFAULT_END }] };
}

export function PharmacyDeliveryScheduleEditor({ value, onChange, disabled }: Props) {
  const locked = Boolean(disabled);
  const parsed = useMemo(() => parsePharmacyDeliveryScheduleForEdit(value), [value]);
  const cfg = useMemo(() => ensureBusinessHoursPayload(parsed), [parsed]);
  const deliverOnHolidays = parsed.deliver_on_holidays === true;
  const holidayDelivery = (parsed.holiday_delivery as HolidayDeliverySchedule) || defaultHolidayDelivery();

  const pushBase = (nextCfg: BusinessHoursPayload, extras?: Partial<JsonObj>) => {
    onChange({
      ...parsePharmacyDeliveryScheduleForEdit({
        ...parsed,
        timezone: nextCfg.timezone,
        weekly: nextCfg.weekly,
        holidays: nextCfg.holidays,
        ...extras,
      }),
    });
  };

  const setDay = (day: Weekday, patch: Partial<BusinessHoursPayload['weekly'][Weekday]>) => {
    const prev = cfg.weekly[day];
    pushBase({
      ...cfg,
      weekly: { ...cfg.weekly, [day]: { ...prev, ...patch } },
    });
  };

  const setDeliverOnHolidays = (on: boolean) => {
    onChange(
      parsePharmacyDeliveryScheduleForEdit({
        ...parsed,
        deliver_on_holidays: on,
        holiday_delivery: on ? defaultHolidayDelivery() : { is_open: false, intervals: [] },
      })
    );
  };

  const setHolidayDelivery = (patch: Partial<HolidayDeliverySchedule>) => {
    const prev = holidayDelivery;
    const next: HolidayDeliverySchedule = {
      is_open: patch.is_open ?? prev.is_open,
      intervals: patch.intervals ?? prev.intervals,
    };
    onChange(
      parsePharmacyDeliveryScheduleForEdit({
        ...parsed,
        deliver_on_holidays: true,
        holiday_delivery: next,
      })
    );
  };

  const allHolidays = sortByDateAsc(cfg.holidays);
  const exceptionRows = allHolidays.filter(
    (h) =>
      h.is_open !== false &&
      (h.intervals?.length || 0) > 0 &&
      String(h.name || '').startsWith(PHARMACY_EXCEPTION_PREFIX)
  );

  const [draftExceptions, setDraftExceptions] = useState<DraftException[]>([]);

  useEffect(() => {
    const exceptionDates = new Set(exceptionRows.map((h) => h.date));
    setDraftExceptions((prev) => prev.filter((d) => !d.date || !exceptionDates.has(d.date)));
  }, [exceptionRows.length]);

  const upsertException = (
    date: string,
    next: { is_open: boolean; name?: string; intervals?: { start: string; end: string }[] }
  ) => {
    const cleanDate = String(date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) return;
    const filtered = cfg.holidays.filter((h) => h.date !== cleanDate);
    pushBase({
      ...cfg,
      holidays: [
        ...filtered,
        {
          date: cleanDate,
          is_open: next.is_open,
          intervals: next.is_open
            ? next.intervals?.length
              ? next.intervals
              : [{ start: DEFAULT_START, end: DEFAULT_END }]
            : [],
          name: next.name,
        },
      ],
    });
  };

  const removeException = (date: string) => {
    pushBase({ ...cfg, holidays: cfg.holidays.filter((h) => h.date !== date) });
  };

  const hdIntervals = holidayDelivery.intervals.length
    ? holidayDelivery.intervals
    : [{ start: DEFAULT_START, end: DEFAULT_END }];
  const hdStart = clampTime(hdIntervals[0]?.start || '', DEFAULT_START);
  const hdEnd = clampTime(hdIntervals[0]?.end || '', DEFAULT_END);

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-background">
            <tr className="text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
              <th className="px-3 py-2">Dia</th>
              <th className="px-3 py-2">Entrega</th>
              <th className="px-3 py-2">Início</th>
              <th className="px-3 py-2">Fim</th>
            </tr>
          </thead>
          <tbody>
            {DAYS.map(({ label, key }) => {
              const day = cfg.weekly[key];
              const active = Boolean(day.is_open && day.intervals.length > 0);
              const start = clampTime(day.intervals[0]?.start || '', DEFAULT_START);
              const end = clampTime(day.intervals[0]?.end || '', DEFAULT_END);
              return (
                <tr key={key} className="border-t border-border/60">
                  <td className="px-3 py-2 font-medium">{label}</td>
                  <td className="px-3 py-2">
                    <Switch
                      checked={active}
                      onCheckedChange={(c) => {
                        if (locked) return;
                        if (!c) {
                          setDay(key, { is_open: false, intervals: [] });
                          return;
                        }
                        setDay(key, { is_open: true, intervals: [{ start, end }] });
                      }}
                      disabled={locked}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="time"
                      disabled={locked || !active}
                      value={start}
                      onChange={(e) => {
                        const nextStart = clampTime(e.target.value, DEFAULT_START);
                        setDay(key, { is_open: true, intervals: [{ start: nextStart, end }] });
                      }}
                      className="h-8 w-28 rounded-md border border-border bg-background px-2 text-xs outline-none disabled:opacity-50"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="time"
                      disabled={locked || !active}
                      value={end}
                      onChange={(e) => {
                        const nextEnd = clampTime(e.target.value, DEFAULT_END);
                        setDay(key, { is_open: true, intervals: [{ start, end: nextEnd }] });
                      }}
                      className="h-8 w-28 rounded-md border border-border bg-background px-2 text-xs outline-none disabled:opacity-50"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-md border border-border bg-background/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-foreground">Entrega em dias de feriado?</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Feriados nacionais. Exceções por data específica podem ser cadastradas abaixo.
            </p>
          </div>
          <Switch checked={deliverOnHolidays} onCheckedChange={setDeliverOnHolidays} disabled={locked} />
        </div>

        {deliverOnHolidays ? (
          <div className="mt-4 border-t border-border/60 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-subtle-foreground">
              Horário de entrega em feriados
            </h3>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label className="text-xs text-muted-foreground">
                Início
                <input
                  type="time"
                  disabled={locked}
                  value={hdStart}
                  onChange={(e) =>
                    setHolidayDelivery({
                      is_open: true,
                      intervals: [{ start: clampTime(e.target.value, DEFAULT_START), end: hdEnd }],
                    })
                  }
                  className="mt-1 block h-8 w-28 rounded-md border border-border bg-background px-2 text-xs outline-none disabled:opacity-50"
                />
              </label>
              <label className="text-xs text-muted-foreground">
                Fim
                <input
                  type="time"
                  disabled={locked}
                  value={hdEnd}
                  onChange={(e) =>
                    setHolidayDelivery({
                      is_open: true,
                      intervals: [{ start: hdStart, end: clampTime(e.target.value, DEFAULT_END) }],
                    })
                  }
                  className="mt-1 block h-8 w-28 rounded-md border border-border bg-background px-2 text-xs outline-none disabled:opacity-50"
                />
              </label>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">Em feriados nacionais o delivery não funciona.</p>
        )}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-subtle-foreground">
            Exceções (turnos especiais)
          </h3>
          <button
            type="button"
            disabled={locked}
            onClick={() => {
              if (locked) return;
              setDraftExceptions((curr) => [
                ...curr,
                { id: draftId('exc'), date: '', name: '', start: DEFAULT_START, end: '12:00' },
              ]);
            }}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-surface-hover',
              locked && 'opacity-50 pointer-events-none'
            )}
          >
            <Plus className="h-3 w-3" /> Adicionar
          </button>
        </div>

        <div className="space-y-2">
          {exceptionRows.map((h) => {
            const date = String(h.date || '');
            const rawName = String(h.name || '');
            const name = rawName.startsWith(PHARMACY_EXCEPTION_PREFIX)
              ? rawName.slice(PHARMACY_EXCEPTION_PREFIX.length).trimStart()
              : rawName;
            const start = clampTime(h.intervals?.[0]?.start || '', DEFAULT_START);
            const end = clampTime(h.intervals?.[0]?.end || '', '12:00');
            return (
              <div key={date} className="flex items-center gap-2 rounded-md border border-border bg-background p-2">
                <input
                  type="date"
                  value={date}
                  disabled={locked}
                  onChange={(e) => {
                    const nextDate = e.target.value;
                    removeException(date);
                    upsertException(nextDate, { is_open: true, name: rawName, intervals: [{ start, end }] });
                  }}
                  className="h-8 w-40 rounded-md border border-border bg-background px-2 text-xs outline-none disabled:opacity-50"
                />
                <input
                  value={name}
                  disabled={locked}
                  placeholder="Motivo"
                  onChange={(e) => {
                    upsertException(date, {
                      is_open: true,
                      name: `${PHARMACY_EXCEPTION_PREFIX} ${e.target.value}`.trim(),
                      intervals: [{ start, end }],
                    });
                  }}
                  className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none disabled:opacity-50"
                />
                <input
                  type="time"
                  value={start}
                  disabled={locked || !date}
                  onChange={(e) => {
                    const nextStart = clampTime(e.target.value, DEFAULT_START);
                    if (date) upsertException(date, { is_open: true, name: rawName, intervals: [{ start: nextStart, end }] });
                  }}
                  className="h-8 w-28 rounded-md border border-border bg-background px-2 text-xs outline-none disabled:opacity-50"
                />
                <input
                  type="time"
                  value={end}
                  disabled={locked || !date}
                  onChange={(e) => {
                    const nextEnd = clampTime(e.target.value, '12:00');
                    if (date) upsertException(date, { is_open: true, name: rawName, intervals: [{ start, end: nextEnd }] });
                  }}
                  className="h-8 w-28 rounded-md border border-border bg-background px-2 text-xs outline-none disabled:opacity-50"
                />
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => removeException(date)}
                  className={cn('text-muted-foreground hover:text-destructive', locked && 'opacity-50 pointer-events-none')}
                  aria-label="Remover exceção"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          {draftExceptions.map((d) => (
            <div key={d.id} className="flex items-center gap-2 rounded-md border border-border bg-background p-2">
              <input
                type="date"
                value={d.date}
                disabled={locked}
                onChange={(e) => {
                  const nextDate = e.target.value;
                  setDraftExceptions((curr) => curr.map((x) => (x.id === d.id ? { ...x, date: nextDate } : x)));
                  if (/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
                    upsertException(nextDate, {
                      is_open: true,
                      name: `${PHARMACY_EXCEPTION_PREFIX} ${d.name}`.trim(),
                      intervals: [{ start: d.start, end: d.end }],
                    });
                  }
                }}
                className="h-8 w-40 rounded-md border border-border bg-background px-2 text-xs outline-none disabled:opacity-50"
              />
              <input
                value={d.name}
                disabled={locked}
                placeholder="Motivo"
                onChange={(e) =>
                  setDraftExceptions((curr) => curr.map((x) => (x.id === d.id ? { ...x, name: e.target.value } : x)))
                }
                className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none disabled:opacity-50"
              />
              <input
                type="time"
                value={d.start}
                disabled={locked || !d.date}
                onChange={(e) => {
                  const nextStart = clampTime(e.target.value, DEFAULT_START);
                  setDraftExceptions((curr) => curr.map((x) => (x.id === d.id ? { ...x, start: nextStart } : x)));
                  if (/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
                    upsertException(d.date, {
                      is_open: true,
                      name: `${PHARMACY_EXCEPTION_PREFIX} ${d.name}`.trim(),
                      intervals: [{ start: nextStart, end: d.end }],
                    });
                  }
                }}
                className="h-8 w-28 rounded-md border border-border bg-background px-2 text-xs outline-none disabled:opacity-50"
              />
              <input
                type="time"
                value={d.end}
                disabled={locked || !d.date}
                onChange={(e) => {
                  const nextEnd = clampTime(e.target.value, '12:00');
                  setDraftExceptions((curr) => curr.map((x) => (x.id === d.id ? { ...x, end: nextEnd } : x)));
                  if (/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
                    upsertException(d.date, {
                      is_open: true,
                      name: `${PHARMACY_EXCEPTION_PREFIX} ${d.name}`.trim(),
                      intervals: [{ start: d.start, end: nextEnd }],
                    });
                  }
                }}
                className="h-8 w-28 rounded-md border border-border bg-background px-2 text-xs outline-none disabled:opacity-50"
              />
              <button
                type="button"
                disabled={locked}
                onClick={() => setDraftExceptions((curr) => curr.filter((x) => x.id !== d.id))}
                className={cn('text-muted-foreground hover:text-destructive', locked && 'opacity-50 pointer-events-none')}
                aria-label="Remover exceção"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {exceptionRows.length === 0 && draftExceptions.length === 0 ? (
            <div className="py-2 text-center text-xs text-subtle-foreground">Nenhuma exceção cadastrada.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
