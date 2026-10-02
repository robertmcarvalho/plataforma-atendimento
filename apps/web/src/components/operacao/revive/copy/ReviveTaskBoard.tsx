'use client';

import { CheckCircle2, ClipboardList, Filter } from 'lucide-react';
import { FilterChips } from '@/components/ui/FilterChips';
import { IconTile } from '@/components/ui/IconTile';
import { Skeleton } from '@/components/ui/Skeleton';
import { ReviveTaskCard, taskIconOverride } from '@/components/operacao/revive/copy/ReviveTaskCard';
import type { TarefaAtendimento } from '@/lib/operacao/reviveCopy/operacaoReviveTypes';
import { cn } from '@/lib/utils';

export function ReviveTaskBoard({
  tarefas,
  loading,
  onOpen,
  mostraFinalizadas,
  onToggleFinalizadas,
  taskTypeFilter,
  onTaskTypeFilterChange,
  taskTypeOptions,
  statusFilter,
  onStatusFilterChange,
  statusFilterOptions,
}: {
  tarefas: TarefaAtendimento[];
  loading: boolean;
  onOpen: (t: TarefaAtendimento) => void;
  mostraFinalizadas: boolean;
  onToggleFinalizadas: (v: boolean) => void;
  taskTypeFilter?: string;
  onTaskTypeFilterChange?: (value: string) => void;
  taskTypeOptions?: Array<{ id: string; label: string }>;
  statusFilter?: string;
  onStatusFilterChange?: (value: string) => void;
  statusFilterOptions?: Array<{ id: string; label: string }>;
}) {
  const visiveis = mostraFinalizadas
    ? tarefas.filter((t) => t.status === 'concluida')
    : tarefas.filter((t) => t.status !== 'concluida');

  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <IconTile icon={ClipboardList} tone="primary" size="sm" /> Tarefas do setor
        </h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onToggleFinalizadas(false)}
            className={cn(
              'rounded-md border px-2 py-1 text-[11px] transition-colors',
              !mostraFinalizadas ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border bg-background/40 text-muted-foreground'
            )}
          >
            <Filter className="mr-1 inline h-3 w-3" strokeWidth={1.75} />
            Em execução · {tarefas.filter((t) => t.status !== 'concluida').length}
          </button>
          <button
            type="button"
            onClick={() => onToggleFinalizadas(true)}
            className={cn(
              'rounded-md border px-2 py-1 text-[11px] transition-colors',
              mostraFinalizadas ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border bg-background/40 text-muted-foreground'
            )}
          >
            <CheckCircle2 className="mr-1 inline h-3 w-3" strokeWidth={1.75} />
            Finalizadas · {tarefas.filter((t) => t.status === 'concluida').length}
          </button>
        </div>
      </div>

      {taskTypeOptions?.length && onTaskTypeFilterChange ? (
        <div className="mb-3 space-y-2 rounded-xl border border-dashed border-border bg-surface/40 px-3 py-2.5">
          <div className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Tipo de tarefa</div>
          <FilterChips
            items={taskTypeOptions}
            value={taskTypeFilter || ''}
            onChange={onTaskTypeFilterChange}
          />
          {statusFilterOptions?.length && onStatusFilterChange ? (
            <>
              <div className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Período / status</div>
              <FilterChips
                items={statusFilterOptions}
                value={statusFilter || ''}
                onChange={onStatusFilterChange}
              />
            </>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      ) : visiveis.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-background/50 p-10 text-center text-sm text-muted-foreground">
          {mostraFinalizadas ? 'Nenhuma tarefa finalizada no período.' : 'Nenhuma tarefa em execução.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {visiveis.map((t) => (
            <ReviveTaskCard key={t.id} tarefa={t} icon={taskIconOverride[t.tipo]} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}
