'use client';

import { cn } from '@/lib/utils';

export type BillingStatusChipOption<T extends string = string> = {
  id: T;
  label: string;
};

export function BillingStatusChips<T extends string>({
  value,
  onChange,
  options,
  allLabel = 'Todos',
  allowAll = true,
  className,
}: {
  value: T | '';
  onChange: (next: T | '') => void;
  options: BillingStatusChipOption<T>[];
  allLabel?: string;
  /** When true, empty value shows an “all” chip. */
  allowAll?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {allowAll ? (
        <button
          type="button"
          onClick={() => onChange('')}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
            value === ''
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-border bg-surface text-muted-foreground hover:border-primary/30 hover:text-foreground'
          )}
        >
          {allLabel}
        </button>
      ) : null}
      {options.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => onChange(chip.id)}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
            value === chip.id
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-border bg-surface text-muted-foreground hover:border-primary/30 hover:text-foreground'
          )}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
