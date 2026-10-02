'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  ReviveAlertasPanel,
  ReviveNotificacoesPanel,
  ReviveQuickActionsPanel,
} from '@/components/operacao/revive/copy/ReviveAsidePanels';
import { ReviveCycleEventsSection } from '@/components/operacao/revive/copy/ReviveCycleEventsSection';
import { ReviveKpiGrid } from '@/components/operacao/revive/copy/ReviveKpiGrid';
import { ReviveOperationContextBar } from '@/components/operacao/revive/copy/ReviveOperationContextBar';
import {
  formatRefreshedAt,
  RevivePeriodHeaderActions,
} from '@/components/operacao/revive/copy/RevivePeriodHeaderActions';
import { ReviveTaskBoard } from '@/components/operacao/revive/copy/ReviveTaskBoard';
import { ReviveTaskExecutionDialog } from '@/components/operacao/revive/copy/ReviveTaskExecutionDialog';
import type { ExecutionBoard } from '@/lib/ops/opsAnalyticsApi';
import { EMPTY_FILA_VIEW, executionBoardToReviveModel } from '@/lib/operacao/reviveCopy/hubToReviveModel';
import { resolveAlertaTarefa } from '@/lib/operacao/reviveCopy/alertaActions';
import { revivePerfilMeta } from '@/lib/operacao/reviveCopy/reviveProfileMeta';
import type { ReviveQuickAction } from '@/lib/operacao/reviveCopy/reviveQuickActions';
import type { AlertaOperacional, TarefaAtendimento } from '@/lib/operacao/reviveCopy/operacaoReviveTypes';
import { cn } from '@/lib/utils';

export function OperacaoExecucaoReviveView({
  mode,
  board,
  loading,
  error,
  period,
  onPeriodChange,
  referenceDate,
  onReferenceDateChange,
  onRefresh,
  refreshing,
  headerActions,
  selectedTaskId,
  onSelectTask,
  quickActions = [],
  taskTypeFilter,
  onTaskTypeFilterChange,
  taskTypeOptions,
  statusFilter,
  onStatusFilterChange,
  statusFilterOptions,
}: {
  mode: 'execucao_geral' | 'execucao_financeiro';
  board?: ExecutionBoard;
  loading: boolean;
  error: boolean;
  period: number;
  onPeriodChange: (days: number) => void;
  referenceDate?: string;
  onReferenceDateChange?: (isoDate: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  headerActions?: ReactNode;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  quickActions?: ReviveQuickAction[];
  taskTypeFilter?: string;
  onTaskTypeFilterChange?: (value: string) => void;
  taskTypeOptions?: Array<{ id: string; label: string }>;
  statusFilter?: string;
  onStatusFilterChange?: (value: string) => void;
  statusFilterOptions?: Array<{ id: string; label: string }>;
}) {
  const qc = useQueryClient();
  const perfil = mode === 'execucao_financeiro' ? 'atendente_financeiro' : 'atendente_geral';
  const meta = revivePerfilMeta[perfil];

  const [mostraFinalizadas, setMostraFinalizadas] = useState(false);
  const [tarefaAtiva, setTarefaAtiva] = useState<TarefaAtendimento | null>(null);
  const [refreshedAt, setRefreshedAt] = useState(formatRefreshedAt);

  const view = useMemo(
    () =>
      board
        ? executionBoardToReviveModel(board, mode === 'execucao_financeiro' ? 'financeiro' : 'geral')
        : EMPTY_FILA_VIEW,
    [board, mode]
  );

  const tarefas = view.tarefas;

  useEffect(() => {
    if (!selectedTaskId) return;
    const t = tarefas.find((x) => x.id === selectedTaskId);
    if (t) setTarefaAtiva(t);
  }, [selectedTaskId, tarefas]);

  useEffect(() => {
    if (!loading && !refreshing) setRefreshedAt(formatRefreshedAt());
  }, [loading, refreshing]);

  const handleRefresh = () => {
    onRefresh();
    setRefreshedAt(formatRefreshedAt());
  };

  const handleOpenTarefa = (t: TarefaAtendimento) => {
    setTarefaAtiva(t);
    onSelectTask(t.id);
  };

  const handleAlertClick = (alerta: AlertaOperacional) => {
    const t = resolveAlertaTarefa(alerta, tarefas);
    if (t) {
      handleOpenTarefa(t);
      return;
    }
    if (alerta.href) {
      window.location.href = alerta.href;
    }
  };

  const handleTarefaChanged = () => {
    void qc.invalidateQueries({ queryKey: ['ops-analytics', 'execution-board'] });
    setTarefaAtiva(null);
    onSelectTask(null);
  };

  const taskGrid = (
    <div
      className={cn(
        'grid grid-cols-1 gap-6 lg:grid-cols-3',
        mode === 'execucao_financeiro' && 'mb-6'
      )}
    >
      <div className="lg:col-span-2">
        <ReviveTaskBoard
          tarefas={tarefas}
          loading={loading}
          onOpen={handleOpenTarefa}
          mostraFinalizadas={mostraFinalizadas}
          onToggleFinalizadas={setMostraFinalizadas}
          taskTypeFilter={taskTypeFilter}
          onTaskTypeFilterChange={onTaskTypeFilterChange}
          taskTypeOptions={taskTypeOptions}
          statusFilter={statusFilter}
          onStatusFilterChange={onStatusFilterChange}
          statusFilterOptions={statusFilterOptions}
        />
      </div>
      <aside className="space-y-4">
        {mode === 'execucao_geral' && quickActions.length > 0 ? (
          <ReviveQuickActionsPanel actions={quickActions} />
        ) : null}
        <ReviveAlertasPanel alertas={view.alertas} loading={loading} onAlertClick={handleAlertClick} />
        <ReviveNotificacoesPanel
          notificacoes={view.notificacoes}
          onOpenTarefa={(id) => {
            const t = tarefas.find((x) => x.id === id);
            if (t) handleOpenTarefa(t);
          }}
        />
      </aside>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-8 py-8">
        <PageHeader
          icon={meta.icon}
          live
          eyebrow={meta.eyebrow}
          title="Painel Operacional"
          description={meta.description}
          actions={
            <>
              <RevivePeriodHeaderActions
                period={period}
                onPeriodChange={onPeriodChange}
                referenceDate={referenceDate}
                onReferenceDateChange={onReferenceDateChange}
                onRefresh={handleRefresh}
                refreshing={refreshing}
                refreshedAt={refreshedAt}
              />
              {headerActions}
            </>
          }
        />

        <ReviveOperationContextBar breadcrumb={[meta.label, 'turno atual']} />

        {error ? <p className="mb-4 text-sm text-destructive">Não foi possível carregar os dados.</p> : null}

        <ReviveKpiGrid kpis={view.kpis} loading={loading} />

        {taskGrid}
        <ReviveCycleEventsSection
          eventos={view.eventos}
          loading={loading}
          financeiro
          referenceDate={referenceDate}
          onReferenceDateChange={onReferenceDateChange}
          periodDays={board?.period_days}
        />

        <ReviveTaskExecutionDialog
          tarefa={tarefaAtiva}
          open={!!tarefaAtiva}
          onOpenChange={(o) => {
            if (!o) {
              setTarefaAtiva(null);
              onSelectTask(null);
            }
          }}
          onChanged={handleTarefaChanged}
        />
      </div>
    </div>
  );
}
