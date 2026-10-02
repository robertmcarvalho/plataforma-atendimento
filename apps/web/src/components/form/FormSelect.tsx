'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formControlSizes } from '@/components/form/FormControl';
import { cn } from '@/lib/utils';
import type { SelectOption } from '@/components/form/ToolbarSelect';

const EMPTY_SELECT_VALUE = '__empty__';

/** Select de formulário — popover shadcn, alinhado a FormControl (substitui `<select>` nativo). */
export function FormSelect({
  value,
  onChange,
  options,
  placeholder = 'Selecione…',
  disabled,
  size = 'md',
  className,
  contentClassName,
  itemClassName,
  id,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  size?: keyof typeof formControlSizes;
  className?: string;
  contentClassName?: string;
  itemClassName?: string;
  id?: string;
  'aria-label'?: string;
}) {
  const normalizedOptions = options.map((o) => ({ ...o, selectValue: o.value || EMPTY_SELECT_VALUE }));
  const items = Object.fromEntries(normalizedOptions.map((o) => [o.selectValue, o.label]));

  return (
    <Select
      value={value || EMPTY_SELECT_VALUE}
      onValueChange={(v) => onChange(v === EMPTY_SELECT_VALUE ? '' : v ?? '')}
      disabled={disabled}
      items={items}
    >
      <SelectTrigger
        id={id}
        size={size === 'sm' ? 'sm' : 'default'}
        aria-label={ariaLabel}
        className={cn(
          'w-full rounded-[8px] border-border bg-background/40 text-foreground',
          'focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/20',
          'dark:bg-background/40 dark:hover:bg-background/40',
          size === 'sm' ? 'h-8 text-xs' : size === 'lg' ? 'h-10 text-sm' : 'h-9 text-sm',
          className
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} sideOffset={4} className={contentClassName}>
        {normalizedOptions.map((o) => (
          <SelectItem key={o.selectValue} value={o.selectValue} disabled={o.disabled} className={itemClassName}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
