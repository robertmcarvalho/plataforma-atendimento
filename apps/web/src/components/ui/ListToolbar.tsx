import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Toolbar de listagem Revive — busca + filtros em linha (Entregadores, Leads, Farmácias). */
export function ListToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Buscar…',
  children,
  trailing,
  className,
}: {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  children?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-center gap-2', className)}>
      {onSearchChange !== undefined ? (
        <div className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            value={searchValue ?? ''}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-subtle-foreground"
          />
        </div>
      ) : null}
      {children}
      {trailing}
    </div>
  );
}
