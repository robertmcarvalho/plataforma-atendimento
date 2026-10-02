'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type FilterChipItem<T extends string = string> = {
  id: T;
  label: string;
};

export function FilterChips<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: FilterChipItem<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {items.map((item) => (
        <Button
          key={item.id}
          type="button"
          size="sm"
          variant={value === item.id ? 'default' : 'outline'}
          onClick={() => onChange(item.id)}
          className={cn('h-7 max-lg:h-9 rounded-full px-3 text-[11px]', value !== item.id && 'text-muted-foreground')}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
}
