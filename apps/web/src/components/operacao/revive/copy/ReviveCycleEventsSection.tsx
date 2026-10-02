'use client';

import { useState } from 'react';
import { Calendar, UserPlus } from 'lucide-react';
import { weekBoundsMonSun } from '@plataforma/financial-cycle';
import { IconTile } from '@/components/ui/IconTile';
import { formatDateBr } from '@/lib/datetimeBr';
import { cn } from '@/lib/utils';
import { ReviveCycleEventsTable } from '@/components/operacao/revive/copy/ReviveCycleEventsTable';
import type { EventoCiclo } from '@/lib/operacao/reviveCopy/operacaoReviveTypes';

const FILTROS = [
  { id: 'todos', label: 'Todos' },
  { id: 'entrada', label: 'Entradas' },
  { id: 'desligamento', label: 'Desligamentos' },
] as const;

function operativeWeekLabel(referenceDate: string): string {
  const { startDate, endDate } = weekBoundsMonSun(referenceDate);
  return `${formatDateBr(startDate)} – ${formatDateBr(endDate)}`;
}

export function ReviveCycleEventsSection({
  eventos,
  loading,
  showFilters = true,
  financeiro = false,
  referenceDate,
  onReferenceDateChange,
  periodDays,
}: {
  eventos: EventoCiclo[];
  loading?: boolean;
  showFilters?: boolean;
  financeiro?: boolean;
  referenceDate?: string;
  onReferenceDateChange?: (isoDate: string) => void;
  periodDays?: number;
}) {
  const [eventoFiltro, setEventoFiltro] = useState<'todos' | 'entrada' | 'desligamento'>('todos');
  const weekLabel = referenceDate ? operativeWeekLabel(referenceDate) : null;

  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <IconTile icon={UserPlus} tone="info" size="sm" /> Entradas e desligamentos {financeiro ? 'do ciclo' : 'no ciclo'}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {onReferenceDateChange ? (
            <div
              className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-2 py-1"
              title="Semana operativa (seg–dom) usada para filtrar entradas e desligamentos"
            >
              <Calendar className="h-3 w-3 text-primary" strokeWidth={1.75} />
              <span className="text-[10px] font-semibold uppercase text-primary">Ciclo</span>
              <input
                type="date"
                lang="pt-BR"
                value={referenceDate || ''}
                onChange={(e) => onReferenceDateChange(e.target.value)}
                className="min-w-[7.5rem] cursor-pointer border-none bg-transparent font-mono text-xs text-foreground outline-none"
              />
              {weekLabel ? (
                <span className="hidden text-[10px] text-muted-foreground sm:inline">({weekLabel})</span>
              ) : null}
              {periodDays ? (
                <span className="text-[10px] text-muted-foreground">· {periodDays}d</span>
              ) : null}
            </div>
          ) : null}
          {showFilters ? (
            <div className="flex items-center gap-1.5">
              {FILTROS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setEventoFiltro(f.id)}
                  className={cn(
                    'rounded-md border px-2 py-1 text-[11px] transition-colors',
                    eventoFiltro === f.id
                      ? 'border-primary/40 bg-primary/15 text-primary'
                      : 'border-border bg-background/40 text-muted-foreground',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {weekLabel ? (
        <p className="mb-2 text-[11px] text-muted-foreground sm:hidden">
          Semana operativa: {weekLabel}
          {periodDays ? ` · janela de ${periodDays} dias` : ''}
        </p>
      ) : null}
      <ReviveCycleEventsTable eventos={eventos} loading={loading} filter={eventoFiltro} financeiro={financeiro} />
    </section>
  );
}
