'use client';

import { Calendar, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateBr } from '@/lib/datetimeBr';

const PERIODOS = [
  { id: 1, label: 'Hoje' },
  { id: 7, label: '7 dias' },
  { id: 30, label: '30 dias' },
] as const;

function formatRefreshedAt() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function RevivePeriodHeaderActions({
  period,
  onPeriodChange,
  referenceDate,
  onReferenceDateChange,
  onRefresh,
  refreshing,
  refreshedAt,
}: {
  period: number;
  onPeriodChange: (days: number) => void;
  referenceDate?: string;
  onReferenceDateChange?: (isoDate: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  refreshedAt: string;
}) {
  const active = period === 1 ? 1 : period <= 7 ? 7 : 30;

  return (
    <>
      {onReferenceDateChange ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1">
          <Calendar className="h-3 w-3 text-muted-foreground" strokeWidth={1.75} />
          <span className="text-[10px] font-semibold uppercase text-muted-foreground">Referência</span>
          <input
            type="date"
            lang="pt-BR"
            value={referenceDate || ''}
            onChange={(e) => onReferenceDateChange(e.target.value)}
            className="min-w-[7.5rem] cursor-pointer border-none bg-transparent font-mono text-xs text-foreground outline-none"
            title={referenceDate ? formatDateBr(referenceDate) : 'Data de referência'}
          />
        </div>
      ) : null}
      <div className="flex items-center rounded-md border border-border bg-surface p-0.5">
        {PERIODOS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPeriodChange(p.id)}
            className={cn(
              'rounded px-2.5 py-1 text-xs font-medium transition-colors',
              active === p.id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {onRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs transition-colors hover:bg-sidebar-accent/60"
          title={`Última atualização: ${refreshedAt}`}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} strokeWidth={1.75} />
          {refreshedAt}
        </button>
      ) : null}
    </>
  );
}

export { formatRefreshedAt };
