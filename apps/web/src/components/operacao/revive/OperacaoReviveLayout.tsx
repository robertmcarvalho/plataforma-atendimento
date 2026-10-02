'use client';

import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { FilterChips } from '@/components/ui/FilterChips';
import { cn } from '@/lib/utils';

const PERIOD_CHIPS = [
  { id: '1', label: 'Hoje' },
  { id: '7', label: '7 dias' },
  { id: '30', label: '30 dias' },
] as const;

export function OperacaoReviveLayout({
  children,
  period,
  onPeriodChange,
  onRefresh,
  refreshing,
  breadcrumb,
  className,
}: {
  children: ReactNode;
  period: number;
  onPeriodChange: (days: number) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  breadcrumb?: ReactNode;
  className?: string;
}) {
  const periodId = period === 1 ? '1' : period <= 7 ? '7' : '30';

  return (
    <div className={cn('mx-auto max-w-7xl px-4 py-6 pb-8 sm:px-8 sm:py-8', className)}>
      {breadcrumb ? <div className="mb-4 text-xs text-muted-foreground">{breadcrumb}</div> : null}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <FilterChips
          items={[...PERIOD_CHIPS]}
          value={periodId}
          onChange={(id) => onPeriodChange(Number(id))}
        />
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            Atualizar
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}
