'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { FilterChips } from '@/components/ui/FilterChips';
import { OperacaoCarteiraReviveView } from '@/components/operacao/OperacaoCarteiraReviveView';
import {
  fetchGestorOperacionalAttendants,
  fetchGestorOperacionalHub,
} from '@/lib/ops/opsAnalyticsApi';
import { useOpsHubFilters } from '@/lib/operacao/useOpsHubFilters';

const ALL_ATTENDANTS = 'todos';

export function OperacaoGestorOperacionalPage() {
  const searchParams = useSearchParams();
  const deepTask = searchParams.get('task');

  const { period, setPeriod, referenceDate, setReferenceDate, pharmacyId, setPharmacyId, hydrated } =
    useOpsHubFilters(30);
  const [attendantId, setAttendantId] = useState(ALL_ATTENDANTS);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (deepTask) setSelectedTaskId(deepTask);
  }, [deepTask]);

  const attendantsQuery = useQuery({
    queryKey: ['ops-analytics', 'gestor-attendants'],
    queryFn: fetchGestorOperacionalAttendants,
  });

  const hubQuery = useQuery({
    queryKey: ['ops-analytics', 'gestor-hub', period, referenceDate, pharmacyId, attendantId],
    queryFn: () =>
      fetchGestorOperacionalHub(period, attendantId === ALL_ATTENDANTS ? undefined : attendantId, {
        referenceDate,
        pharmacyId: pharmacyId || undefined,
      }),
    enabled: hydrated,
    refetchInterval: 45_000,
  });

  const attendants = attendantsQuery.data?.attendants || [];
  const attendantLabel =
    attendantId === ALL_ATTENDANTS
      ? 'Todos os analistas operacionais'
      : attendants.find((a) => a.id === attendantId)?.name || 'Analista';

  const filterItems = [
    { id: ALL_ATTENDANTS, label: `Todos · ${attendants.length || '…'}` },
    ...attendants.map((a) => ({ id: a.id, label: a.name })),
  ];

  return (
    <OperacaoCarteiraReviveView
      hub={hubQuery.data}
      loading={hubQuery.isLoading || attendantsQuery.isLoading}
      error={hubQuery.isError}
      period={period}
      onPeriodChange={setPeriod}
      referenceDate={referenceDate}
      onReferenceDateChange={setReferenceDate}
      pharmacyId={pharmacyId}
      onPharmacyIdChange={setPharmacyId}
      pharmacies={hubQuery.data?.summary?.pharmacies || []}
      onRefresh={() => {
        void attendantsQuery.refetch();
        void hubQuery.refetch();
      }}
      refreshing={hubQuery.isFetching}
      perfil="gestor_operacional"
      showQuickActions={false}
      selectedTaskId={selectedTaskId}
      onSelectTask={setSelectedTaskId}
      toolbar={
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-surface/40 px-4 py-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            <span>
              Analista: <span className="font-medium text-foreground">{attendantLabel}</span>
              {hubQuery.data?.summary ? (
                <>
                  {' '}
                  · <span className="font-mono">{hubQuery.data.summary.totals.pharmacies}</span> farmácias
                </>
              ) : null}
            </span>
          </div>
          <FilterChips items={filterItems} value={attendantId} onChange={setAttendantId} className="max-w-full" />
        </div>
      }
    />
  );
}
