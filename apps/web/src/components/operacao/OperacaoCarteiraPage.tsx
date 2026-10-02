'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DriverPreCadastroModal, DriverTerminationRequestModal } from '@/components/operacao/DriverLifecycleModals';
import { OccurrenceWizard } from '@/components/occurrences/OccurrenceWizard';
import { OperacaoCarteiraReviveView } from '@/components/operacao/OperacaoCarteiraReviveView';
import { OperacaoCreateTaskModal } from '@/components/operacao/revive/OperacaoCreateTaskModal';
import { Button } from '@/components/ui/button';
import { fetchPortfolioLaunchContext, fetchPortfolioOperationsHub } from '@/lib/ops/opsAnalyticsApi';
import { useOpsHubFilters } from '@/lib/operacao/useOpsHubFilters';
import { analistaQuickActions } from '@/lib/operacao/reviveCopy/reviveQuickActions';

export function OperacaoCarteiraPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const deepTask = searchParams.get('task');

  const { period, setPeriod, referenceDate, setReferenceDate, pharmacyId, setPharmacyId, hydrated } =
    useOpsHubFilters(7);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardLeaderId, setWizardLeaderId] = useState<string | undefined>();
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [preCadastroOpen, setPreCadastroOpen] = useState(false);
  const [terminationOpen, setTerminationOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (deepTask) setSelectedTaskId(deepTask);
  }, [deepTask]);

  const hubQuery = useQuery({
    queryKey: ['ops-analytics', 'portfolio-hub', period, referenceDate, pharmacyId],
    queryFn: () =>
      fetchPortfolioOperationsHub(period, {
        referenceDate,
        pharmacyId: pharmacyId || undefined,
      }),
    enabled: hydrated,
    refetchInterval: 45_000,
  });

  const launchQuery = useQuery({
    queryKey: ['ops-analytics', 'launch-context', wizardLeaderId],
    queryFn: () => fetchPortfolioLaunchContext(wizardLeaderId),
    enabled: wizardOpen,
  });

  const quickActions = useMemo(
    () =>
      analistaQuickActions({
        onOccurrence: () => setWizardOpen(true),
        onPreCadastro: () => setPreCadastroOpen(true),
        onTermination: () => setTerminationOpen(true),
      }),
    [],
  );

  return (
    <>
      <OperacaoCarteiraReviveView
        hub={hubQuery.data}
        loading={hubQuery.isLoading}
        error={hubQuery.isError}
        period={period}
        onPeriodChange={setPeriod}
        referenceDate={referenceDate}
        onReferenceDateChange={setReferenceDate}
        pharmacyId={pharmacyId}
        onPharmacyIdChange={setPharmacyId}
        pharmacies={hubQuery.data?.summary?.pharmacies || []}
        onRefresh={() => void hubQuery.refetch()}
        refreshing={hubQuery.isFetching}
        perfil="analista_operacional"
        quickActions={quickActions}
        headerActions={
          <Button type="button" size="sm" onClick={() => setTaskModalOpen(true)}>
            Nova tarefa
          </Button>
        }
        selectedTaskId={selectedTaskId}
        onSelectTask={setSelectedTaskId}
      />

      <OperacaoCreateTaskModal
        open={taskModalOpen}
        onClose={() => setTaskModalOpen(false)}
        scope="portfolio"
        analystMode
        onCreated={(taskId, deepLink) => {
          void qc.invalidateQueries({ queryKey: ['ops-analytics'] });
          setSelectedTaskId(taskId);
          router.push(deepLink);
        }}
      />

      <DriverPreCadastroModal
        open={preCadastroOpen}
        onClose={() => setPreCadastroOpen(false)}
        onSuccess={() => void qc.invalidateQueries({ queryKey: ['ops-analytics'] })}
      />
      <DriverTerminationRequestModal
        open={terminationOpen}
        onClose={() => setTerminationOpen(false)}
        onSuccess={() => void qc.invalidateQueries({ queryKey: ['ops-analytics'] })}
      />

      {wizardOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-lg">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Ocorrência de escala</h3>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setWizardOpen(false)}
              >
                Fechar
              </button>
            </div>
            <OccurrenceWizard
              mode="attendant"
              leaders={(launchQuery.data?.leaders || []).map((l) => ({ id: l.id, name: l.name }))}
              initialLeaderId={wizardLeaderId}
              drivers={launchQuery.data?.drivers || []}
              pharmacies={launchQuery.data?.pharmacies || []}
              driversLoading={launchQuery.isLoading}
              pharmaciesLoading={launchQuery.isLoading}
              layout="modal"
              onCancel={() => setWizardOpen(false)}
              onSuccess={() => {
                setWizardOpen(false);
                void qc.invalidateQueries({ queryKey: ['ops-analytics'] });
              }}
            />
            {launchQuery.isError ? (
              <p className="mt-3 text-xs text-destructive">
                Não foi possível carregar líderes e entregadores da carteira.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
