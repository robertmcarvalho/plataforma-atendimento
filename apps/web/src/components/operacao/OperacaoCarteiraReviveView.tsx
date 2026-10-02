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
import { ReviveComplianceSection } from '@/components/operacao/revive/copy/ReviveComplianceSection';
import { ReviveCycleEventsSection } from '@/components/operacao/revive/copy/ReviveCycleEventsSection';
import { ReviveKpiGrid } from '@/components/operacao/revive/copy/ReviveKpiGrid';
import { ReviveOperationContextBar } from '@/components/operacao/revive/copy/ReviveOperationContextBar';
import {
  formatRefreshedAt,
  RevivePeriodHeaderActions,
} from '@/components/operacao/revive/copy/RevivePeriodHeaderActions';
import { RevivePharmacySection } from '@/components/operacao/revive/copy/RevivePharmacySection';
import { ReviveTaskBoard } from '@/components/operacao/revive/copy/ReviveTaskBoard';
import { ReviveTaskExecutionDialog } from '@/components/operacao/revive/copy/ReviveTaskExecutionDialog';
import type { PortfolioOperationsHub } from '@/lib/ops/opsAnalyticsApi';
import { EMPTY_OPERACAO_VIEW, hubToReviveModel } from '@/lib/operacao/reviveCopy/hubToReviveModel';
import type { ReviveQuickAction } from '@/lib/operacao/reviveCopy/reviveQuickActions';
import { resolveAlertaTarefa } from '@/lib/operacao/reviveCopy/alertaActions';
import { revivePerfilMeta, type ReviveOperacaoPerfil } from '@/lib/operacao/reviveCopy/reviveProfileMeta';
import type { AlertaOperacional, TarefaAtendimento } from '@/lib/operacao/reviveCopy/operacaoReviveTypes';

export function OperacaoCarteiraReviveView({
  hub,
  loading,
  error,
  period,
  onPeriodChange,
  referenceDate,
  onReferenceDateChange,
  pharmacyId,
  onPharmacyIdChange,
  pharmacies = [],
  onRefresh,
  refreshing,
  perfil = 'analista_operacional',
  selectedTaskId,
  onSelectTask,
  toolbar,
  showQuickActions = true,
  quickActions = [],
  headerActions,
}: {
  hub?: PortfolioOperationsHub;
  loading: boolean;
  error: boolean;
  period: number;
  onPeriodChange: (days: number) => void;
  referenceDate?: string;
  onReferenceDateChange?: (isoDate: string) => void;
  pharmacyId?: string;
  onPharmacyIdChange?: (id: string) => void;
  pharmacies?: Array<{ id: string; trade_name: string }>;
  onRefresh: () => void;
  refreshing: boolean;
  perfil?: ReviveOperacaoPerfil;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  toolbar?: ReactNode;
  showQuickActions?: boolean;
  quickActions?: ReviveQuickAction[];
  headerActions?: ReactNode;
}) {
  const qc = useQueryClient();
  const meta = revivePerfilMeta[perfil];

  const [mostraFinalizadas, setMostraFinalizadas] = useState(false);
  const [tarefaAtiva, setTarefaAtiva] = useState<TarefaAtendimento | null>(null);
  const [tarefasLocal, setTarefasLocal] = useState<TarefaAtendimento[] | null>(null);
  const [refreshedAt, setRefreshedAt] = useState(formatRefreshedAt);

  const view = useMemo(() => (hub ? hubToReviveModel(hub) : EMPTY_OPERACAO_VIEW), [hub]);
  const tarefas = tarefasLocal ?? view.tarefas;

  useEffect(() => {
    setTarefasLocal(null);
  }, [view.tarefas, hub]);

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
    if (t) handleOpenTarefa(t);
  };

  const handleTarefaChanged = () => {
    void qc.invalidateQueries({ queryKey: ['ops-analytics'] });
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

        {toolbar}

        <ReviveOperationContextBar breadcrumb={[meta.label, 'turno atual']} />

        {error ? <p className="mb-4 text-sm text-destructive">Não foi possível carregar os dados.</p> : null}

        <ReviveKpiGrid kpis={view.kpis} loading={loading} />

        <div className="mb-6 grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
          <RevivePharmacySection farmacias={view.farmacias} loading={loading} />

          <aside className="space-y-4">
            <ReviveAlertasPanel alertas={view.alertas} loading={loading} onAlertClick={handleAlertClick} />
            <ReviveNotificacoesPanel
              notificacoes={view.notificacoes}
              onOpenTarefa={(id) => {
                const t = tarefas.find((x) => x.id === id);
                if (t) handleOpenTarefa(t);
              }}
            />
            {showQuickActions && quickActions.length > 0 ? (
              <ReviveQuickActionsPanel actions={quickActions} />
            ) : null}
          </aside>
        </div>

        <ReviveComplianceSection
          compliance={view.compliance}
          loading={loading}
          pharmacyId={pharmacyId}
          onPharmacyIdChange={onPharmacyIdChange}
          pharmacies={pharmacies}
        />
        <ReviveCycleEventsSection
          eventos={view.eventos}
          loading={loading}
          financeiro
          referenceDate={referenceDate}
          onReferenceDateChange={onReferenceDateChange}
          periodDays={hub?.period_days}
        />

        <ReviveTaskBoard
          tarefas={tarefas}
          loading={loading}
          onOpen={handleOpenTarefa}
          mostraFinalizadas={mostraFinalizadas}
          onToggleFinalizadas={setMostraFinalizadas}
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
