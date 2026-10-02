'use client';

import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { BrDateInput, BrTimeInput } from '@/components/form/BrInputs';
import { formControlFlexClassName } from '@/components/form/FormControl';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/Switch';
import {
  ensureBusinessHoursPayload,
  type BusinessHoursPayload,
  type Weekday,
} from '@/components/settings/BusinessHoursEditor';

type JsonObj = Record<string, unknown>;

type Props = {
  value: JsonObj | undefined;
  onChange: (next: JsonObj) => void;
  disabled?: boolean;
  readonly?: boolean;
};

type DayRow = { label: string; key: Weekday };

const DAYS: DayRow[] = [
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

function toJson(cfg: BusinessHoursPayload): JsonObj {
  return {
    timezone: cfg.timezone,
    weekly: cfg.weekly,
    holidays: cfg.holidays,
  };
}

function clampTime(value: string, fallback: string) {
  const v = String(value || '').trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(v) ? v : fallback;
}

function sortByDateAsc<T extends { date: string }>(rows: T[]) {
  return [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

type DraftHoliday = { id: string; date: string; name: string; works: boolean };
type DraftException = { id: string; date: string; name: string; start: string; end: string };

const EXCEPTION_PREFIX = 'EXC:';

function draftId(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export function DriverWorkScheduleEditor({ value, onChange, disabled, readonly }: Props) {
  const locked = Boolean(disabled || readonly);
  const cfg = useMemo(() => ensureBusinessHoursPayload(value), [value]);

  const push = (next: BusinessHoursPayload) => {
    onChange(toJson(next));
  };

  const setDay = (day: Weekday, patch: Partial<BusinessHoursPayload['weekly'][Weekday]>) => {
    const prev = cfg.weekly[day];
    push({
      ...cfg,
      weekly: { ...cfg.weekly, [day]: { ...prev, ...patch } },
    });
  };

  const exceptionRows = useMemo(() => {
    const allHolidays = sortByDateAsc(cfg.holidays);
    return allHolidays.filter(
      (h) => h.is_open !== false && (h.intervals?.length || 0) > 0 && String(h.name || '').startsWith(EXCEPTION_PREFIX),
    );
  }, [cfg.holidays]);

  const holidayRows = useMemo(() => {
    const allHolidays = sortByDateAsc(cfg.holidays);
    return allHolidays.filter((h) => !exceptionRows.some((x) => x.date === h.date));
  }, [cfg.holidays, exceptionRows]);

  const [draftHolidays, setDraftHolidays] = useState<DraftHoliday[]>([]);
  const [draftExceptions, setDraftExceptions] = useState<DraftException[]>([]);

  const holidayDates = useMemo(() => new Set(holidayRows.map((h) => h.date)), [holidayRows]);
  const exceptionDates = useMemo(() => new Set(exceptionRows.map((h) => h.date)), [exceptionRows]);
  const visibleDraftHolidays = useMemo(
    () => draftHolidays.filter((d) => !d.date || !holidayDates.has(d.date)),
    [draftHolidays, holidayDates],
  );
  const visibleDraftExceptions = useMemo(
    () => draftExceptions.filter((d) => !d.date || !exceptionDates.has(d.date)),
    [draftExceptions, exceptionDates],
  );

  const upsertHoliday = (date: string, next: { is_open: boolean; name?: string; intervals?: { start: string; end: string }[] }) => {
    const cleanDate = String(date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) return;

    const filtered = cfg.holidays.filter((h) => h.date !== cleanDate);
    push({
      ...cfg,
      holidays: [
        ...filtered,
        {
          date: cleanDate,
          is_open: next.is_open,
          intervals: next.is_open ? (next.intervals?.length ? next.intervals : [{ start: DEFAULT_START, end: DEFAULT_END }]) : [],
          name: next.name,
        },
      ],
    });
  };

  const removeHoliday = (date: string) => {
    push({ ...cfg, holidays: cfg.holidays.filter((h) => h.date !== date) });
  };

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-background">
            <tr className="text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
              <th className="px-3 py-2">Dia</th>
              <th className="px-3 py-2">Trabalha</th>
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
                    {active ? (
                      <BrTimeInput
                        disabled={locked}
                        value={start}
                        onChange={(nextStart) => {
                          setDay(key, { is_open: true, intervals: [{ start: clampTime(nextStart, DEFAULT_START), end }] });
                        }}
                      />
                    ) : (
                      <span className="inline-flex h-8 w-28 items-center text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {active ? (
                      <BrTimeInput
                        disabled={locked}
                        value={end}
                        onChange={(nextEnd) => {
                          setDay(key, { is_open: true, intervals: [{ start, end: clampTime(nextEnd, DEFAULT_END) }] });
                        }}
                      />
                    ) : (
                      <span className="inline-flex h-8 w-28 items-center text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Feriados */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-subtle-foreground">Feriados</h3>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={locked}
            onClick={() => {
              if (locked) return;
              setDraftHolidays((curr) => [...curr, { id: draftId('holiday'), date: '', name: '', works: false }]);
            }}
          >
            <Plus className="h-3 w-3" /> Adicionar
          </Button>
        </div>

        <div className="space-y-2">
          {holidayRows.map((h) => {
            const date = String(h.date || '');
            const name = String(h.name || '');
            const works = h.is_open !== false;
            return (
              <div key={date} className="flex items-center gap-2 rounded-md border border-border bg-background p-2">
                <BrDateInput
                  value={date}
                  disabled={locked}
                  onChange={(nextDate) => {
                    removeHoliday(date);
                    if (nextDate) upsertHoliday(nextDate, { is_open: false, name, intervals: [] });
                  }}
                />
                <input
                  value={name}
                  disabled={locked}
                  placeholder="Descrição"
                  onChange={(e) => {
                    const nextName = e.target.value;
                    upsertHoliday(date, {
                      is_open: works,
                      name: nextName,
                      intervals: works ? [{ start: DEFAULT_START, end: DEFAULT_END }] : [],
                    });
                  }}
                  className={formControlFlexClassName}
                />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={works}
                    disabled={locked || !date}
                    onChange={(e) => {
                      if (!date) return;
                      const checked = e.target.checked;
                      if (checked) {
                        upsertHoliday(date, { is_open: true, name, intervals: [{ start: DEFAULT_START, end: DEFAULT_END }] });
                      } else {
                        upsertHoliday(date, { is_open: false, name, intervals: [] });
                      }
                    }}
                    className="h-3.5 w-3.5 rounded border border-border bg-background accent-primary"
                  />
                  Trabalha
                </label>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    removeHoliday(date);
                  }}
                  className={cn('text-muted-foreground hover:text-destructive', locked && 'opacity-50 pointer-events-none')}
                  aria-label="Remover feriado"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          {visibleDraftHolidays.map((d) => (
            <div key={d.id} className="flex items-center gap-2 rounded-md border border-border bg-background p-2">
              <BrDateInput
                value={d.date}
                disabled={locked}
                onChange={(nextDate) => {
                  setDraftHolidays((curr) => curr.map((x) => (x.id === d.id ? { ...x, date: nextDate } : x)));
                  if (/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
                    upsertHoliday(nextDate, { is_open: false, name: d.name, intervals: [] });
                  }
                }}
              />
              <input
                value={d.name}
                disabled={locked}
                placeholder="Descrição"
                onChange={(e) => setDraftHolidays((curr) => curr.map((x) => (x.id === d.id ? { ...x, name: e.target.value } : x)))}
                className={formControlFlexClassName}
              />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={d.works}
                  disabled={locked || !d.date}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setDraftHolidays((curr) => curr.map((x) => (x.id === d.id ? { ...x, works: checked } : x)));
                    if (/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
                      upsertHoliday(d.date, { is_open: checked, name: d.name, intervals: checked ? [{ start: DEFAULT_START, end: DEFAULT_END }] : [] });
                    }
                  }}
                  className="h-3.5 w-3.5 rounded border border-border bg-background accent-primary"
                />
                Trabalha
              </label>
              <button
                type="button"
                disabled={locked}
                onClick={() => setDraftHolidays((curr) => curr.filter((x) => x.id !== d.id))}
                className={cn('text-muted-foreground hover:text-destructive', locked && 'opacity-50 pointer-events-none')}
                aria-label="Remover feriado"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {holidayRows.length === 0 && visibleDraftHolidays.length === 0 ? (
            <div className="py-2 text-center text-xs text-subtle-foreground">Nenhum feriado adicionado.</div>
          ) : null}
        </div>
      </div>

      {/* Exceções (aberto) */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-subtle-foreground">Exceções (turnos especiais)</h3>
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={locked}
            onClick={() => {
              if (locked) return;
              setDraftExceptions((curr) => [
                ...curr,
                { id: draftId('exc'), date: '', name: '', start: DEFAULT_START, end: '12:00' },
              ]);
            }}
          >
            <Plus className="h-3 w-3" /> Adicionar
          </Button>
        </div>

        <div className="space-y-2">
          {exceptionRows.map((h) => {
            const date = String(h.date || '');
            const rawName = String(h.name || '');
            const name = rawName.startsWith(EXCEPTION_PREFIX) ? rawName.slice(EXCEPTION_PREFIX.length).trimStart() : rawName;
            const start = clampTime(h.intervals?.[0]?.start || '', DEFAULT_START);
            const end = clampTime(h.intervals?.[0]?.end || '', '12:00');
            return (
              <div key={date} className="flex items-center gap-2 rounded-md border border-border bg-background p-2">
                <BrDateInput
                  value={date}
                  disabled={locked}
                  onChange={(nextDate) => {
                    removeHoliday(date);
                    if (nextDate) upsertHoliday(nextDate, { is_open: true, name: rawName, intervals: [{ start, end }] });
                  }}
                />
                <input
                  value={name}
                  disabled={locked}
                  placeholder="Motivo"
                  onChange={(e) => {
                    const nextName = e.target.value;
                    upsertHoliday(date, { is_open: true, name: `${EXCEPTION_PREFIX} ${nextName}`.trim(), intervals: [{ start, end }] });
                  }}
                  className={formControlFlexClassName}
                />
                <BrTimeInput
                  value={start}
                  disabled={locked || !date}
                  onChange={(nextStart) => {
                    if (date) upsertHoliday(date, { is_open: true, name: rawName, intervals: [{ start: clampTime(nextStart, DEFAULT_START), end }] });
                  }}
                />
                <BrTimeInput
                  value={end}
                  disabled={locked || !date}
                  onChange={(nextEnd) => {
                    if (date) upsertHoliday(date, { is_open: true, name: rawName, intervals: [{ start, end: clampTime(nextEnd, '12:00') }] });
                  }}
                />
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    removeHoliday(date);
                  }}
                  className={cn('text-muted-foreground hover:text-destructive', locked && 'opacity-50 pointer-events-none')}
                  aria-label="Remover exceção"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          {visibleDraftExceptions.map((d) => (
            <div key={d.id} className="flex items-center gap-2 rounded-md border border-border bg-background p-2">
              <BrDateInput
                value={d.date}
                disabled={locked}
                onChange={(nextDate) => {
                  setDraftExceptions((curr) => curr.map((x) => (x.id === d.id ? { ...x, date: nextDate } : x)));
                  if (/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
                    upsertHoliday(nextDate, { is_open: true, name: `${EXCEPTION_PREFIX} ${d.name}`.trim(), intervals: [{ start: d.start, end: d.end }] });
                  }
                }}
              />
              <input
                value={d.name}
                disabled={locked}
                placeholder="Motivo"
                onChange={(e) => setDraftExceptions((curr) => curr.map((x) => (x.id === d.id ? { ...x, name: e.target.value } : x)))}
                className={formControlFlexClassName}
              />
              <BrTimeInput
                value={d.start}
                disabled={locked || !d.date}
                onChange={(nextStart) => {
                  const start = clampTime(nextStart, DEFAULT_START);
                  setDraftExceptions((curr) => curr.map((x) => (x.id === d.id ? { ...x, start } : x)));
                  if (/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
                    upsertHoliday(d.date, { is_open: true, name: `${EXCEPTION_PREFIX} ${d.name}`.trim(), intervals: [{ start, end: d.end }] });
                  }
                }}
              />
              <BrTimeInput
                value={d.end}
                disabled={locked || !d.date}
                onChange={(nextEnd) => {
                  const end = clampTime(nextEnd, '12:00');
                  setDraftExceptions((curr) => curr.map((x) => (x.id === d.id ? { ...x, end } : x)));
                  if (/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
                    upsertHoliday(d.date, { is_open: true, name: `${EXCEPTION_PREFIX} ${d.name}`.trim(), intervals: [{ start: d.start, end }] });
                  }
                }}
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
          {exceptionRows.length === 0 && visibleDraftExceptions.length === 0 ? (
            <div className="py-2 text-center text-xs text-subtle-foreground">Nenhuma exceção cadastrada.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
