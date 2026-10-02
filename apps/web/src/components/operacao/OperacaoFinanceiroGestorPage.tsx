'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { OperacaoGestorFinanceiroReviveView } from '@/components/operacao/OperacaoGestorFinanceiroReviveView';
import { fetchFinancialOperationsHub } from '@/lib/ops/opsAnalyticsApi';
import { useOpsHubFilters } from '@/lib/operacao/useOpsHubFilters';

export function OperacaoFinanceiroGestorPage() {
  const searchParams = useSearchParams();
  const deepTask = searchParams.get('task');

  const { period, setPeriod, referenceDate, setReferenceDate, pharmacyId, setPharmacyId, hydrated } =
    useOpsHubFilters(7);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (deepTask) setSelectedTaskId(deepTask);
  }, [deepTask]);

  const hubQuery = useQuery({
    queryKey: ['ops-analytics', 'financial-hub', period, referenceDate, pharmacyId],
    queryFn: () =>
      fetchFinancialOperationsHub(period, {
        referenceDate,
        pharmacyId: pharmacyId || undefined,
      }),
    enabled: hydrated,
    refetchInterval: 45_000,
  });

  return (
    <OperacaoGestorFinanceiroReviveView
      hub={hubQuery.data}
      loading={hubQuery.isLoading}
      error={hubQuery.isError}
      period={period}
      onPeriodChange={setPeriod}
      referenceDate={referenceDate}
      onReferenceDateChange={setReferenceDate}
      pharmacyId={pharmacyId}
      onPharmacyIdChange={setPharmacyId}
      onRefresh={() => void hubQuery.refetch()}
      refreshing={hubQuery.isFetching}
      selectedTaskId={selectedTaskId}
      onSelectTask={setSelectedTaskId}
    />
  );
}
