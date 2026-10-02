'use client';

import { AlertTriangle, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { ReviveSpark } from '@/components/operacao/revive/copy/ReviveSpark';
import { Skeleton } from '@/components/ui/Skeleton';
import type { KpiOperacional } from '@/lib/operacao/reviveCopy/operacaoReviveTypes';
import { cn } from '@/lib/utils';

export function ReviveKpiGrid({ kpis, loading }: { kpis: KpiOperacional[]; loading: boolean }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {loading
        ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        : kpis.map((k) => (
            <div
              key={k.label}
              className={cn('rounded-xl border bg-surface p-4', k.alerta ? 'border-destructive/40' : 'border-border')}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">{k.label}</span>
                {k.alerta ? <AlertTriangle className="h-3.5 w-3.5 text-destructive" strokeWidth={1.75} /> : null}
              </div>
              <div className="mt-1 flex items-end justify-between">
                <div className="font-mono text-xl font-semibold tracking-tight">{k.valor}</div>
                {k.spark?.length ? (
                  <ReviveSpark
                    data={k.spark}
                    color={k.alerta ? 'hsl(var(--destructive))' : 'hsl(var(--primary))'}
                  />
                ) : null}
              </div>
              {k.delta ? (
                <div
                  className={cn(
                    'mt-1 flex items-center gap-1 text-[10px]',
                    k.deltaTipo === 'up' && 'text-success',
                    k.deltaTipo === 'down' && 'text-destructive',
                    (!k.deltaTipo || k.deltaTipo === 'neutral') && 'text-muted-foreground',
                  )}
                >
                  {k.deltaTipo === 'up' ? <ArrowUpRight className="h-3 w-3" strokeWidth={2} /> : null}
                  {k.deltaTipo === 'down' ? <ArrowDownRight className="h-3 w-3" strokeWidth={2} /> : null}
                  {k.delta}
                </div>
              ) : null}
            </div>
          ))}
    </div>
  );
}
