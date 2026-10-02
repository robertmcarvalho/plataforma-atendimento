'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { interactiveNavItem } from '@/lib/interactiveRow';
import { cn } from '@/lib/utils';

export function ReportMultiSelect({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const summary =
    value.length === 0
      ? 'Todos'
      : value.length === 1
        ? options.find((o) => o.value === value[0])?.label || '1 selecionado'
        : `${value.length} selecionados`;

  return (
    <div className="relative">
      <label className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">{label}</label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'mt-1 flex w-full items-center justify-between rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-left text-xs outline-none focus:border-primary/60',
          disabled && 'cursor-not-allowed opacity-60'
        )}
      >
        <span className="truncate">{summary}</span>
        <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')} />
      </button>
      {open && !disabled ? (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
          {options.length === 0 ? (
            <div className="px-2 py-1.5 text-[11px] text-muted-foreground">Nenhuma opção</div>
          ) : null}
          {options.map((o) => {
            const on = value.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])}
                className={cn(
                  interactiveNavItem(on),
                  'justify-start gap-2 rounded px-2 py-1.5 text-left text-[11px]',
                  on && 'bg-primary/10 text-primary'
                )}
              >
                <span className={cn('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border', on ? 'border-primary bg-primary' : 'border-border')}>
                  {on ? <span className="text-[8px] text-primary-foreground">✓</span> : null}
                </span>
                {o.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
