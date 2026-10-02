'use client';

import { interactiveActive, interactiveHover } from '@/lib/interactiveRow';
import { cn } from '@/lib/utils';

export type SegmentedItem<T extends string = string> = {
  id: T;
  label: string;
};

/** Controle segmentado Revive — `rounded-md border bg-background/40 p-0.5` (período, status, tabs). */
export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  variant = 'elevated',
  size = 'sm',
  stretch = false,
  className,
}: {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (id: T) => void;
  variant?: 'elevated' | 'primary';
  size?: 'sm' | 'xs';
  /** Preenche a largura do campo (formulários Fixo/Diarista). */
  stretch?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'gap-0.5 rounded-md border border-border bg-background p-0.5',
        stretch ? 'flex w-full' : 'inline-flex',
        size === 'xs' ? 'text-xs' : 'text-sm',
        className
      )}
      role="group"
    >
      {items.map((item) => {
        const active = value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={cn(
              'rounded-md px-2.5 py-1.5 font-medium transition-colors',
              stretch && 'flex-1',
              size === 'xs' && 'px-2 py-0.5',
              variant === 'primary'
                ? active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
                : active
                  ? interactiveActive
                  : cn('text-muted-foreground', interactiveHover)
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
