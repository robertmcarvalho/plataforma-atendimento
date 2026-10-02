'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  ReviveAlertasPanel,
  ReviveNotificacoesPanel,
} from '@/components/operacao/revive/copy/ReviveAsidePanels';
import { ReviveCycleEventsSection } from '@/components/operacao/revive/copy/ReviveCycleEventsSection';
import { ReviveDesempenhoSetorPanel } from '@/components/operacao/revive/copy/ReviveDesempenhoSetorPanel';
import { ReviveKpiGrid } from '@/components/operacao/revive/copy/ReviveKpiGrid';
import { ReviveOperationContextBar } from '@/components/operacao/revive/copy/ReviveOperationContextBar';
import {
  formatRefreshedAt,
  RevivePeriodHeaderActions,
} from '@/components/operacao/revive/copy/RevivePeriodHeaderActions';
import { ReviveTaskBoard } from '@/components/operacao/revive/copy/ReviveTaskBoard';
import { ReviveTaskExecutionDialog } from '@/components/operacao/revive/copy/ReviveTaskExecutionDialog';
import type { FinancialOperationsHub } from '@/lib/ops/opsAnalyticsApi';
import {
  EMPTY_GESTOR_FINANCEIRO_VIEW,
  financialHubToReviveModel,
} from '@/lib/operacao/reviveCopy/hubToReviveModel';
import { resolveAlertaTarefa } from '@/lib/operacao/reviveCopy/alertaActions';
import { revivePerfilMeta } from '@/lib/operacao/reviveCopy/reviveProfileMeta';
import type { AlertaOperacional, TarefaAtendimento } from '@/lib/operacao/reviveCopy/operacaoReviveTypes';

export function OperacaoGestorFinanceiroReviveView({
  hub,
  loading,
  error,
  period,
  onPeriodChange,
  referenceDate,
  onReferenceDateChange,
  pharmacyId,
  onPharmacyIdChange,
  onRefresh,
  refreshing,
  selectedTaskId,
  onSelectTask,
}: {
  hub?: FinancialOperationsHub;
  loading: boolean;
  error: boolean;
  period: number;
  onPeriodChange: (days: number) => void;
  referenceDate?: string;
  onReferenceDateChange?: (isoDate: string) => void;
  pharmacyId?: string;
  onPharmacyIdChange?: (id: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
}) {
  const qc = useQueryClient();
  const meta = revivePerfilMeta.gestor_financeiro;

  const [mostraFinalizadas, setMostraFinalizadas] = useState(false);
  const [tarefaAtiva, setTarefaAtiva] = useState<TarefaAtendimento | null>(null);
  const [refreshedAt, setRefreshedAt] = useState(formatRefreshedAt);

  const view = useMemo(
    () => (hub ? financialHubToReviveModel(hub) : EMPTY_GESTOR_FINANCEIRO_VIEW),
    [hub]
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
    }
  };

  const handleTarefaChanged = () => {
    void qc.invalidateQueries({ queryKey: ['ops-analytics', 'financial-hub'] });
    setTarefaAtiva(null);
    onSelectTask(null);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-8 py-8">
        <PageHeader
          icon={meta.icon}
          live
          eyebrow={meta.eyebrow}
          title={meta.label}
          description={meta.description}
          actions={
            <RevivePeriodHeaderActions
              period={period}
              onPeriodChange={onPeriodChange}
              referenceDate={referenceDate}
              onReferenceDateChange={onReferenceDateChange}
              onRefresh={handleRefresh}
              refreshing={refreshing}
              refreshedAt={refreshedAt}
            />
          }
        />

        <ReviveOperationContextBar breadcrumb={[meta.label, 'turno atual']} />

        {error ? <p className="mb-4 text-sm text-destructive">Não foi possível carregar os dados.</p> : null}

        <ReviveKpiGrid kpis={view.kpis} loading={loading} />

        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ReviveAlertasPanel alertas={view.alertas} loading={loading} onAlertClick={handleAlertClick} />
          <ReviveNotificacoesPanel notificacoes={view.notificacoes} />
          <ReviveDesempenhoSetorPanel atendentes={view.desempenhoSetor} />
        </div>

        <ReviveTaskBoard
          tarefas={tarefas}
          loading={loading}
          onOpen={handleOpenTarefa}
          mostraFinalizadas={mostraFinalizadas}
          onToggleFinalizadas={setMostraFinalizadas}
        />

        <ReviveCycleEventsSection
          eventos={view.eventos}
          loading={loading}
          financeiro
          referenceDate={referenceDate}
          onReferenceDateChange={onReferenceDateChange}
          periodDays={hub?.period_days}
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
