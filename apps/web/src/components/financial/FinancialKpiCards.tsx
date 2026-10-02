'use client';

import { Clock, DollarSign, TrendingDown, Wallet } from 'lucide-react';
import { formatBRL } from '@/lib/brFormat';
import { reviveKpiCardLgClassName } from '@/lib/reviveSurfaces';
import { cn } from '@/lib/utils';

export type FinancialKpiCardsProps = {
  stats: {
    cycleDiscounts: number;
    cycleDailies: number;
    pendingApproval: number;
    openInCycle: number;
  };
  onTogglePendingApproval: () => void;
};

export function FinancialKpiCards({ stats, onTogglePendingApproval }: FinancialKpiCardsProps) {
  return (
    <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
      <div className={reviveKpiCardLgClassName}>
        <div className="flex items-center justify-between">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Wallet className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-4 text-2xl font-semibold tracking-tight">{formatBRL(stats.cycleDailies)}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">Diárias (Ter/Qui)</div>
      </div>
      <div className={reviveKpiCardLgClassName}>
        <div className="flex items-center justify-between">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/15 text-destructive">
            <TrendingDown className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-4 text-2xl font-semibold tracking-tight text-destructive">{formatBRL(stats.cycleDiscounts)}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">Descontos da Semana</div>
      </div>
      <div
        onClick={onTogglePendingApproval}
        className={cn(
          reviveKpiCardLgClassName,
          'cursor-pointer border-l-4 border-l-warning hover:bg-sidebar-accent/40 transition-colors'
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/15 text-warning">
            <Clock className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-4 text-2xl font-semibold tracking-tight text-warning">{stats.pendingApproval}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">Lançamentos aguardando</div>
      </div>
      <div className={cn(reviveKpiCardLgClassName, 'border-l-4 border-l-success')}>
        <div className="flex items-center justify-between">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/15 text-success">
            <DollarSign className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-4 text-2xl font-semibold tracking-tight text-success">
          {formatBRL(Math.max(0, stats.cycleDailies - stats.cycleDiscounts))}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">Líquido Estimado</div>
      </div>
    </div>
  );
}
