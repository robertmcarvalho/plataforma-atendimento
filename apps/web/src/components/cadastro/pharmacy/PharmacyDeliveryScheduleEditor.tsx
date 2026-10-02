'use client';

import { useMemo, useState } from 'react';
import { Clock, Plus, X } from 'lucide-react';
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
import {
  PHARMACY_EXCEPTION_PREFIX,
  parsePharmacyDeliveryScheduleForEdit,
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
const DEFAULT_END = '22:00';
const HOLIDAY_DEFAULT_END = '16:00';

function clampTime(value: string, fallback: string) {
  const v = String(value || '').trim().slice(0, 5);
  return /^\d{2}:\d{2}$/.test(v) ? v : fallback;
}

function sortByDateAsc<T extends { date: string }>(rows: T[]) {
  return [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

type DraftHoliday = { id: string; date: string; name: string; opens: boolean; start: string; end: string };

function draftId(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function isNamedHolidayRow(h: { date: string; name?: string }) {
  const name = String(h.name || '').trim();
  return Boolean(h.date) && !name.startsWith(PHARMACY_EXCEPTION_PREFIX);
}

/** Editor alinhado ao Revive `FarmaciaCadastro` — grade semanal + feriados (HH:mm / dd/mm/aaaa). */
export function PharmacyDeliveryScheduleEditor({ value, onChange, disabled }: Props) {
  const locked = Boolean(disabled);
  const parsed = useMemo(() => parsePharmacyDeliveryScheduleForEdit(value), [value]);
  const cfg = useMemo(() => ensureBusinessHoursPayload(parsed), [parsed]);

  const push = (next: BusinessHoursPayload, extras?: Partial<JsonObj>) => {
    onChange(
      parsePharmacyDeliveryScheduleForEdit({
        ...parsed,
        timezone: next.timezone,
        weekly: next.weekly,
        holidays: next.holidays,
        deliver_on_holidays: false,
        holiday_delivery: { is_open: false, intervals: [] },
        ...extras,
      }),
    );
  };

  const setDay = (day: Weekday, patch: Partial<BusinessHoursPayload['weekly'][Weekday]>) => {
    const prev = cfg.weekly[day];
    push({
      ...cfg,
      weekly: { ...cfg.weekly, [day]: { ...prev, ...patch } },
    });
  };

  const holidayRows = useMemo(() => {
    return sortByDateAsc(cfg.holidays).filter(isNamedHolidayRow);
  }, [cfg.holidays]);

  const [draftHolidays, setDraftHolidays] = useState<DraftHoliday[]>([]);
  const holidayDates = useMemo(() => new Set(holidayRows.map((h) => h.date)), [holidayRows]);
  const visibleDraftHolidays = useMemo(
    () => draftHolidays.filter((d) => !d.date || !holidayDates.has(d.date)),
    [draftHolidays, holidayDates],
  );

  const upsertHoliday = (
    date: string,
    next: { is_open: boolean; name?: string; intervals?: { start: string; end: string }[] },
  ) => {
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
          intervals: next.is_open
            ? next.intervals?.length
              ? next.intervals
              : [{ start: '10:00', end: HOLIDAY_DEFAULT_END }]
            : [],
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
              <th className="px-3 py-2">Abre</th>
              <th className="px-3 py-2">
                <Clock className="inline h-3 w-3" /> Início
              </th>
              <th className="px-3 py-2">
                <Clock className="inline h-3 w-3" /> Fim
              </th>
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
              setDraftHolidays((curr) => [
                ...curr,
                { id: draftId('hol'), date: '', name: '', opens: false, start: '10:00', end: HOLIDAY_DEFAULT_END },
              ]);
            }}
          >
            <Plus className="h-3 w-3" /> Adicionar feriado
          </Button>
        </div>
        <div className="space-y-2">
          {holidayRows.map((h) => {
            const date = String(h.date || '');
            const name = String(h.name || '');
            const opens = h.is_open !== false && (h.intervals?.length || 0) > 0;
            const start = clampTime(h.intervals?.[0]?.start || '', '10:00');
            const end = clampTime(h.intervals?.[0]?.end || '', HOLIDAY_DEFAULT_END);
            return (
              <div key={date} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background p-2">
                <BrDateInput
                  value={date}
                  disabled={locked}
                  onChange={(nextDate) => {
                    removeHoliday(date);
                    if (nextDate) {
                      upsertHoliday(nextDate, {
                        is_open: opens,
                        name,
                        intervals: opens ? [{ start, end }] : [],
                      });
                    }
                  }}
                />
                <input
                  value={name}
                  disabled={locked}
                  placeholder="Descrição"
                  onChange={(e) => {
                    upsertHoliday(date, {
                      is_open: opens,
                      name: e.target.value,
                      intervals: opens ? [{ start, end }] : [],
                    });
                  }}
                  className={cn(formControlFlexClassName, 'min-w-[180px]')}
                />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={opens}
                    disabled={locked || !date}
                    onChange={(e) => {
                      if (!date) return;
                      const checked = e.target.checked;
                      upsertHoliday(date, {
                        is_open: checked,
                        name,
                        intervals: checked ? [{ start, end }] : [],
                      });
                    }}
                    className="h-3.5 w-3.5 rounded border border-border bg-background accent-primary"
                  />
                  Abre
                </label>
                <BrTimeInput
                  value={start}
                  disabled={locked || !opens || !date}
                  onChange={(nextStart) => {
                    if (date) upsertHoliday(date, { is_open: true, name, intervals: [{ start: clampTime(nextStart, '10:00'), end }] });
                  }}
                />
                <BrTimeInput
                  value={end}
                  disabled={locked || !opens || !date}
                  onChange={(nextEnd) => {
                    if (date) upsertHoliday(date, { is_open: true, name, intervals: [{ start, end: clampTime(nextEnd, HOLIDAY_DEFAULT_END) }] });
                  }}
                />
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => removeHoliday(date)}
                  className={cn('text-muted-foreground hover:text-destructive', locked && 'pointer-events-none opacity-50')}
                  aria-label="Remover feriado"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          {visibleDraftHolidays.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background p-2">
              <BrDateInput
                value={d.date}
                disabled={locked}
                onChange={(nextDate) => {
                  setDraftHolidays((curr) => curr.map((x) => (x.id === d.id ? { ...x, date: nextDate } : x)));
                  if (/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
                    upsertHoliday(nextDate, {
                      is_open: d.opens,
                      name: d.name,
                      intervals: d.opens ? [{ start: d.start, end: d.end }] : [],
                    });
                  }
                }}
              />
              <input
                value={d.name}
                disabled={locked}
                placeholder="Descrição"
                onChange={(e) => setDraftHolidays((curr) => curr.map((x) => (x.id === d.id ? { ...x, name: e.target.value } : x)))}
                className={cn(formControlFlexClassName, 'min-w-[180px]')}
              />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={d.opens}
                  disabled={locked || !d.date}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setDraftHolidays((curr) => curr.map((x) => (x.id === d.id ? { ...x, opens: checked } : x)));
                    if (/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
                      upsertHoliday(d.date, {
                        is_open: checked,
                        name: d.name,
                        intervals: checked ? [{ start: d.start, end: d.end }] : [],
                      });
                    }
                  }}
                  className="h-3.5 w-3.5 rounded border border-border bg-background accent-primary"
                />
                Abre
              </label>
              <BrTimeInput
                value={d.start}
                disabled={locked || !d.opens || !d.date}
                onChange={(nextStart) => {
                  const start = clampTime(nextStart, '10:00');
                  setDraftHolidays((curr) => curr.map((x) => (x.id === d.id ? { ...x, start } : x)));
                  if (/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
                    upsertHoliday(d.date, { is_open: true, name: d.name, intervals: [{ start, end: d.end }] });
                  }
                }}
              />
              <BrTimeInput
                value={d.end}
                disabled={locked || !d.opens || !d.date}
                onChange={(nextEnd) => {
                  const end = clampTime(nextEnd, HOLIDAY_DEFAULT_END);
                  setDraftHolidays((curr) => curr.map((x) => (x.id === d.id ? { ...x, end } : x)));
                  if (/^\d{4}-\d{2}-\d{2}$/.test(d.date)) {
                    upsertHoliday(d.date, { is_open: true, name: d.name, intervals: [{ start: d.start, end }] });
                  }
                }}
              />
              <button
                type="button"
                disabled={locked}
                onClick={() => setDraftHolidays((curr) => curr.filter((x) => x.id !== d.id))}
                className={cn('text-muted-foreground hover:text-destructive', locked && 'pointer-events-none opacity-50')}
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
    </div>
  );
}
