'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type SelectOption = { value: string; label: string; disabled?: boolean };

/** base-ui Select não aceita value="" — mapeamos opção vazia para sentinela interna. */
export const TOOLBAR_SELECT_EMPTY_VALUE = '__toolbar_empty__';

const toolbarTriggerClass =
  'h-auto rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground';

const wideMenuClassName =
  'w-max min-w-[var(--anchor-width)] max-w-[min(32rem,calc(100vw-2rem))]';

/** Filtro compacto — padrão toolbar de Entregadores (popover shadcn, não select nativo). */
export function ToolbarSelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  className,
  wideMenu = false,
  fullWidth = false,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Expande o menu para nomes longos (Líder, Cidade). */
  wideMenu?: boolean;
  /** Ocupa a largura do container (filtros inbox). */
  fullWidth?: boolean;
  'aria-label'?: string;
}) {
  const toSelectValue = (v: string) => (v === '' ? TOOLBAR_SELECT_EMPTY_VALUE : v);
  const fromSelectValue = (v: string | null) => (v === TOOLBAR_SELECT_EMPTY_VALUE || v == null ? '' : v);
  const normalizedOptions = options.map((o) => ({
    ...o,
    value: toSelectValue(o.value),
  }));
  const items = Object.fromEntries(normalizedOptions.map((o) => [o.value, o.label]));
  const selectedLabel = options.find((o) => o.value === value)?.label;

  return (
    <Select
      value={toSelectValue(value)}
      onValueChange={(v) => onChange(fromSelectValue(v))}
      disabled={disabled}
      items={items}
    >
      <SelectTrigger
        size="sm"
        aria-label={ariaLabel}
        title={selectedLabel}
        className={cn(
          toolbarTriggerClass,
          fullWidth ? 'w-full min-w-0 max-w-none' : 'w-auto min-w-[5.5rem] max-w-[11rem]',
          className
        )}
      >
        <SelectValue placeholder={placeholder} className="truncate" />
      </SelectTrigger>
      <SelectContent className={cn(wideMenu && wideMenuClassName)}>
        {normalizedOptions.map((o) => (
          <SelectItem
            key={o.value}
            value={o.value}
            disabled={o.disabled}
            className={cn(wideMenu && 'whitespace-normal break-words')}
          >
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
