'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, ArrowRight, CloudDownload, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormControl } from '@/components/form/FormControl';
import { BillingCycleSelect } from '@/components/billing/BillingCycleSelect';
import { BillingCostCenterFilter } from '@/components/billing/BillingCostCenterFilter';
import { BillingDriverFilter } from '@/components/billing/BillingDriverFilter';
import { BillingEntityName } from '@/components/billing/BillingEntityName';
import { BillingPharmacyFilter } from '@/components/billing/BillingPharmacyFilter';
import { BillingActionFeedbackDialog, BillingDialogContent, BillingEmptyState, BillingField } from '@/components/billing/BillingPrimitives';
import { BillingStatusChips } from '@/components/billing/BillingStatusChips';
import { PaginationControls } from '@/components/ui/PaginationControls';
import {
  approveAllSettlements,
  closeBillingCycle,
  createBillingCycle,
  downloadPixBatchExport,
  fetchBillingCycles,
  fetchBillingSettlements,
  fetchSuggestedCycle,
  recalculateBillingCycle,
  submitAllSettlements,
} from '@/lib/billing/billingApi';
import {
  fireFluxDeliverySync,
  fireMysqlReconcile,
  formatBillingSyncRangeLabel,
  resolveBillingSyncRange,
} from '@/lib/billing/billingFluxIngest';
import {
  pickDefaultOpenCycleId,
  readCycleParam,
  replaceQueryIfChanged,
  writeCycleParam,
} from '@/lib/billing/billingFilterUrl';
import { formatBrlCents, fmtDate, settlementStatusBadge, SETTLEMENT_STATUS_LABELS } from '@/lib/billing/billingFormat';
import { aggregateSettlementsByPharmacy, settlementsHaveStaleDailyDriverPayout, type AggregatedAcertoRow } from '@/lib/billing/billingAcertoAggregate';
import { DEFAULT_LIST_PAGE_SIZE, useClientPagination } from '@/lib/billing/billingListUtils';
import { billingKpiCompactClassName, billingKpiLabelClassName, billingTableShellClassName } from '@/lib/billing/billingReviveUi';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';
import { canManageBillingFinancial } from '@/lib/billing/billingFinancialAuth';

type SettlementStatusFilter = 'open' | 'in_review' | 'approved' | 'paid';

function statusBadge(status: string) {
  const { label, className } = settlementStatusBadge(status);
  return <span className={className}>{label}</span>;
}

function mondaySundayCycleError(startIso: string, endIso: string): string | null {
  if (!startIso || !endIso) return null;
  const start = new Date(`${startIso}T12:00:00.000Z`);
  const end = new Date(`${endIso}T12:00:00.000Z`);
  const diffDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (start.getUTCDay() !== 1) return 'O ciclo deve iniciar em uma segunda-feira.';
  if (end.getUTCDay() !== 0) return 'O ciclo deve finalizar em um domingo.';
  if (diffDays !== 6) return 'O ciclo deve ter exatamente 7 dias, de segunda a domingo.';
  return null;
}

const STATUS_CHIP_OPTIONS: { id: SettlementStatusFilter; label: string }[] = (
  ['open', 'in_review', 'approved', 'paid'] as const
).map((id) => ({ id, label: SETTLEMENT_STATUS_LABELS[id] }));

export function BillingSettlementsPanel() {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useAuth((s) => s.user);
  const canManage = canManageBillingFinancial(user?.role, user?.permissions);
  const cycleFromUrl = readCycleParam(searchParams);
  const pageFromUrl = Math.max(1, Number(searchParams.get('page') || 1));
  const statusFromUrl = (searchParams.get('status') || '') as SettlementStatusFilter | '';
  const pharmacyFromUrl = searchParams.get('pharmacy_id') || '';
  const costCenterFromUrl = searchParams.get('cost_center_id') || '';
  const driverFromUrl = searchParams.get('driver_id') || '';

  const [selectedCycleId, setSelectedCycleId] = useState<string>(cycleFromUrl);
  const [statusFilter, setStatusFilter] = useState<SettlementStatusFilter | ''>(
    statusFromUrl === 'open' || statusFromUrl === 'in_review' || statusFromUrl === 'approved' || statusFromUrl === 'paid'
      ? statusFromUrl
      : ''
  );
  const [pharmacyId, setPharmacyId] = useState(pharmacyFromUrl);
  const [costCenterId, setCostCenterId] = useState(costCenterFromUrl);
  const [driverId, setDriverId] = useState(driverFromUrl);
  const [newCycleOpen, setNewCycleOpen] = useState(false);
  const [apuracaoStart, setApuracaoStart] = useState('');
  const [apuracaoEnd, setApuracaoEnd] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [label, setLabel] = useState('');
  const [feedback, setFeedback] = useState<{ title: string; description: string } | null>(null);

  const cyclesQuery = useQuery({
    queryKey: ['billing', 'cycles'],
    queryFn: fetchBillingCycles,
  });

  const settlementsQuery = useQuery({
    queryKey: ['billing', 'settlements', selectedCycleId],
    queryFn: () => fetchBillingSettlements({ cycle_id: selectedCycleId }),
    enabled: !!selectedCycleId,
  });

  const suggestedQuery = useQuery({
    queryKey: ['billing', 'cycles', 'suggested'],
    queryFn: () => fetchSuggestedCycle(),
    enabled: newCycleOpen,
  });

  const cycles = useMemo(() => cyclesQuery.data || [], [cyclesQuery.data]);
  const selectedCycle = cycles.find((c) => c.id === selectedCycleId);
  const newCycleError = mondaySundayCycleError(apuracaoStart, apuracaoEnd);

  // Hydrate from URL only when the URL changes (back/forward/shared link).
  // Do NOT depend on local cycle state — that races with router.replace and
  // reverts the user's selection, causing an infinite navigation loop.
  useEffect(() => {
    if (!cycleFromUrl) return;
    setSelectedCycleId((prev) => (prev === cycleFromUrl ? prev : cycleFromUrl));
  }, [cycleFromUrl]);

  useEffect(() => {
    if (selectedCycleId || !cycles.length) return;
    const preferred = pickDefaultOpenCycleId(cycles);
    if (preferred) setSelectedCycleId(preferred);
  }, [cycles, selectedCycleId]);

  const clearListFilters = () => {
    setStatusFilter('');
    setPharmacyId('');
    setCostCenterId('');
    setDriverId('');
  };

  const onCycleChange = (id: string) => {
    if (id === selectedCycleId) return;
    setSelectedCycleId(id);
    // Sticky filters from another cycle often zero the table while the API still returns rows.
    // Only update state here — the URL sync effect below writes once after React batches.
    clearListFilters();
  };

  const onPharmacyChange = (id: string) => {
    setPharmacyId(id);
    if (!id) setDriverId('');
  };

  const aggregatedRows = useMemo(() => {
    const all = aggregateSettlementsByPharmacy(settlementsQuery.data || []);
    return all.filter((row) => {
      if (statusFilter && row.status !== statusFilter) return false;
      if (pharmacyId && row.pharmacyId !== pharmacyId) return false;
      if (costCenterId && row.costCenterId !== costCenterId) return false;
      if (driverId && !row.driverIds.includes(driverId)) return false;
      return true;
    });
  }, [settlementsQuery.data, statusFilter, pharmacyId, costCenterId, driverId]);

  const hasActiveListFilters = Boolean(statusFilter || pharmacyId || costCenterId || driverId);

  const staleDailyInWeekly = useMemo(
    () => settlementsHaveStaleDailyDriverPayout(settlementsQuery.data || []),
    [settlementsQuery.data]
  );
  const rowsPagination = useClientPagination(aggregatedRows, DEFAULT_LIST_PAGE_SIZE);
  const initialPageSynced = useRef(false);
  const previousCycleId = useRef(selectedCycleId);
  const previousFiltersKey = useRef(`${statusFilter}|${pharmacyId}|${costCenterId}|${driverId}`);
  const { page: listPage, setPage: setListPage, resetPage } = rowsPagination;

  const buildAcertoDetailHref = (row: AggregatedAcertoRow) => {
    const params = new URLSearchParams();
    writeCycleParam(params, selectedCycleId);
    if (statusFilter) params.set('status', statusFilter);
    if (pharmacyId) params.set('pharmacy_id', pharmacyId);
    if (costCenterId) params.set('cost_center_id', costCenterId);
    if (driverId) params.set('driver_id', driverId);
    if (listPage > 1) params.set('page', String(listPage));
    const qs = params.toString();
    const base = row.settlementIds[0]
      ? `/billing/acertos/${row.settlementIds[0]}`
      : `/billing/acertos/ciclo/${row.cycleId}/farmacia/${row.pharmacyId}`;
    return qs ? `${base}?${qs}` : base;
  };

  useEffect(() => {
    if (initialPageSynced.current) return;
    initialPageSynced.current = true;
    if (pageFromUrl !== listPage) setListPage(pageFromUrl);
  }, [pageFromUrl, listPage, setListPage]);

  // Reset to page 1 when cycle/filters change (after initial URL page hydrate).
  useEffect(() => {
    if (!initialPageSynced.current) return;
    const filtersKey = `${statusFilter}|${pharmacyId}|${costCenterId}|${driverId}`;
    const cycleChanged = previousCycleId.current !== selectedCycleId;
    const filtersChanged = previousFiltersKey.current !== filtersKey;
    if (!cycleChanged && !filtersChanged) return;
    previousCycleId.current = selectedCycleId;
    previousFiltersKey.current = filtersKey;
    resetPage();
  }, [selectedCycleId, statusFilter, pharmacyId, costCenterId, driverId, resetPage]);

  // Single writer for list query ↔ URL (skip when identical to avoid navigation storms).
  useEffect(() => {
    if (!selectedCycleId) return;
    const params = new URLSearchParams(searchParams.toString());
    writeCycleParam(params, selectedCycleId);
    if (statusFilter) params.set('status', statusFilter);
    else params.delete('status');
    if (pharmacyId) params.set('pharmacy_id', pharmacyId);
    else params.delete('pharmacy_id');
    if (costCenterId) params.set('cost_center_id', costCenterId);
    else params.delete('cost_center_id');
    if (driverId) params.set('driver_id', driverId);
    else params.delete('driver_id');
    if (listPage > 1) params.set('page', String(listPage));
    else params.delete('page');
    replaceQueryIfChanged(router, '/billing/acertos', searchParams.toString(), params);
  }, [
    selectedCycleId,
    statusFilter,
    pharmacyId,
    costCenterId,
    driverId,
    listPage,
    router,
    searchParams,
  ]);
  const totals = useMemo(() => {
    return {
      count: aggregatedRows.length,
      pharmacy: aggregatedRows.reduce((a, r) => a + r.totalFaturado, 0),
      driver: aggregatedRows.reduce((a, r) => a + r.totalRepasse, 0),
    };
  }, [aggregatedRows]);

  const createMut = useMutation({
    mutationFn: () =>
      createBillingCycle({
        apuracao_start: apuracaoStart,
        apuracao_end: apuracaoEnd,
        payment_date: paymentDate || null,
        label: label || null,
      }),
    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: ['billing', 'cycles'] });
      setSelectedCycleId(data.cycle.id);
      clearListFilters();
      setNewCycleOpen(false);
    },
  });

  const syncRange = useMemo(() => resolveBillingSyncRange(selectedCycle), [selectedCycle]);

  const syncFluxMut = useMutation({
    mutationFn: () => fireFluxDeliverySync(syncRange),
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ['billing', 'deliveries'] });
      await qc.invalidateQueries({ queryKey: ['billing', 'settlements'] });
    },
  });

  const syncMysqlMut = useMutation({
    mutationFn: () => fireMysqlReconcile(syncRange),
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ['billing', 'deliveries'] });
      await qc.invalidateQueries({ queryKey: ['billing', 'settlements'] });
    },
  });

  const syncInFlight = syncFluxMut.isPending || syncMysqlMut.isPending;

  const closeMut = useMutation({
    mutationFn: () => closeBillingCycle(selectedCycleId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['billing'] });
    },
  });

  const recalcMut = useMutation({
    mutationFn: () => recalculateBillingCycle(selectedCycleId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['billing', 'settlements'] });
    },
    onError: (err) => {
      setFeedback({
        title: 'Recálculo bloqueado',
        description: apiErrorMessage(
          err,
          'Não foi possível recalcular. Se houver acerto aprovado, abra a farmácia e use Estornar acerto.'
        ),
      });
    },
  });

  const submitAllMut = useMutation({
    mutationFn: () => submitAllSettlements(selectedCycleId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing', 'settlements'] }),
  });

  const approveAllMut = useMutation({
    mutationFn: () => approveAllSettlements(selectedCycleId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['billing', 'settlements'] });
      if (data.pix_batch?.row_count) {
        downloadPixBatchExport(data.pix_batch);
      }
    },
  });

  const openNewCycle = () => {
    setNewCycleOpen(true);
  };

  useEffect(() => {
    if (!newCycleOpen || !suggestedQuery.data) return;
    setApuracaoStart(suggestedQuery.data.apuracao_start);
    setApuracaoEnd(suggestedQuery.data.apuracao_end);
    setPaymentDate(suggestedQuery.data.payment_date);
    setLabel(suggestedQuery.data.label);
  }, [newCycleOpen, suggestedQuery.data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <BillingCycleSelect
            value={selectedCycleId}
            onChange={onCycleChange}
            cycles={cycles}
            label="Ciclo de apuração"
            className="min-w-[220px]"
          />
          <BillingPharmacyFilter
            value={pharmacyId}
            onChange={onPharmacyChange}
            className="min-w-[200px]"
          />
          <BillingDriverFilter
            value={driverId}
            onChange={setDriverId}
            pharmacyId={pharmacyId}
            className="min-w-[200px]"
          />
          <BillingCostCenterFilter
            value={costCenterId}
            onChange={setCostCenterId}
            className="min-w-[180px]"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage ? (
            <Button size="sm" variant="outline" onClick={openNewCycle}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Novo ciclo
            </Button>
          ) : null}
          {canManage && selectedCycleId ? (
            <>
              <Button
                size="sm"
                variant="outline"
                title={`API Flux · ${formatBillingSyncRangeLabel(syncRange)}`}
                onClick={() => syncFluxMut.mutate()}
                disabled={syncInFlight}
              >
                <CloudDownload className={cn('mr-1 h-3.5 w-3.5', syncFluxMut.isPending && 'animate-pulse')} />
                {syncFluxMut.isPending ? 'Sincronizando…' : 'Sincronizar Flux'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                title={`MySQL Flux · ${formatBillingSyncRangeLabel(syncRange)}`}
                onClick={() => syncMysqlMut.mutate()}
                disabled={syncInFlight}
              >
                <Database className={cn('mr-1 h-3.5 w-3.5', syncMysqlMut.isPending && 'animate-pulse')} />
                {syncMysqlMut.isPending ? 'Reconciliando…' : 'Reconciliar MySQL'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => recalcMut.mutate()} disabled={recalcMut.isPending}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> Recalcular
              </Button>
              {selectedCycle?.status === 'open' ? (
                <Button size="sm" variant="outline" onClick={() => closeMut.mutate()} disabled={closeMut.isPending}>
                  Fechar ciclo
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => submitAllMut.mutate()} disabled={submitAllMut.isPending}>
                Enviar revisão
              </Button>
              <Button size="sm" onClick={() => approveAllMut.mutate()} disabled={approveAllMut.isPending}>
                Aprovar todos
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <BillingStatusChips
        value={statusFilter}
        onChange={setStatusFilter}
        options={STATUS_CHIP_OPTIONS}
        allLabel="Todos os status"
      />

      {selectedCycle ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <div className={billingKpiCompactClassName}>
            <p className={billingKpiLabelClassName}>Farmácias no ciclo</p>
            <p className="text-lg font-semibold">{totals.count}</p>
          </div>
          <div className={billingKpiCompactClassName}>
            <p className={billingKpiLabelClassName}>A faturar (farmácias)</p>
            <p className="text-lg font-semibold">{formatBrlCents(totals.pharmacy)}</p>
          </div>
          <div className={billingKpiCompactClassName}>
            <p className={billingKpiLabelClassName}>PIX acerto (quinta)</p>
            <p className="text-lg font-semibold">{formatBrlCents(totals.driver)}</p>
          </div>
        </div>
      ) : null}

      {staleDailyInWeekly ? (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <p className="font-medium text-warning">Recalcule antes de aprovar todos</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Clique em <strong>Recalcular</strong> antes de <strong>Aprovar todos</strong>. As diárias já são pagas na
            terça-feira (A pagar → Diárias). O acerto da quinta-feira paga só o complemento. Se não recalcular, o
            sistema pode incluir valor de diária antigo no PIX da quinta.
          </p>
        </div>
      ) : selectedCycleId ? (
        <p className="text-xs text-muted-foreground">
          Diárias (PIX terça) e acerto semanal (PIX quinta) são trilhas distintas. Em A pagar, use o chip Diárias para a
          terça; aqui o total é só o repasse do acerto.
        </p>
      ) : null}

      <div className={billingTableShellClassName}>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
            <tr>
              <th className="px-4 py-3">Ciclo</th>
              <th className="px-4 py-3">Farmácia / Centro de custo</th>
              <th className="px-4 py-3 text-center">Entregadores</th>
              <th className="px-4 py-3 text-right">PIX quinta</th>
              <th className="px-4 py-3 text-right">A faturar</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rowsPagination.pageItems.map((row) => (
              <tr
                key={`${row.cycleId}:${row.pharmacyId}`}
                className="border-b border-border/40 last:border-0 transition-colors hover:bg-surface-hover"
              >
                <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                  {fmtDate(row.apuracaoStart)} → {fmtDate(row.apuracaoEnd)}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium">
                    <BillingEntityName name={row.pharmacyName} />
                  </div>
                  <div className="text-xs text-muted-foreground">{row.costCenterName || '—'}</div>
                </td>
                <td className="px-4 py-3 text-center">{row.driverCount}</td>
                <td className="px-4 py-3 text-right font-mono">{formatBrlCents(row.totalRepasse)}</td>
                <td className="px-4 py-3 text-right font-mono font-semibold">{formatBrlCents(row.totalFaturado)}</td>
                <td className="px-4 py-3">{statusBadge(row.status)}</td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={buildAcertoDetailHref(row)}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    Abrir <ArrowRight className="h-3 w-3" />
                  </Link>
                </td>
              </tr>
            ))}
            {selectedCycleId && settlementsQuery.isLoading ? (
              <tr>
                <td colSpan={7} className="p-4 text-sm text-muted-foreground">
                  Carregando acertos do ciclo…
                </td>
              </tr>
            ) : null}
            {selectedCycleId && settlementsQuery.isError ? (
              <tr>
                <td colSpan={7} className="p-4">
                  <BillingEmptyState>
                    <span className="text-destructive">Falha ao carregar acertos deste ciclo.</span>{' '}
                    {apiErrorMessage(settlementsQuery.error, 'Verifique a conexão e recarregue a página.')}
                  </BillingEmptyState>
                </td>
              </tr>
            ) : null}
            {selectedCycleId &&
            !settlementsQuery.isLoading &&
            !settlementsQuery.isError &&
            !aggregatedRows.length ? (
              <tr>
                <td colSpan={7} className="p-4">
                  <BillingEmptyState>
                    {hasActiveListFilters && (settlementsQuery.data?.length ?? 0) > 0 ? (
                      <>
                        Nenhum acerto corresponde aos filtros ativos (status, farmácia, centro de custo ou
                        entregador).{' '}
                        <button
                          type="button"
                          className="text-primary underline"
                          onClick={clearListFilters}
                        >
                          Limpar filtros
                        </button>
                      </>
                    ) : (
                      <>
                        Nenhum acerto no ciclo. Sincronize Flux/MySQL em Entregas (ou pelos botões acima), depois
                        recalcule ou feche o ciclo.
                      </>
                    )}
                  </BillingEmptyState>
                </td>
              </tr>
            ) : null}
            {!selectedCycleId ? (
              <tr>
                <td colSpan={7} className="p-4">
                  <BillingEmptyState>Selecione ou crie um ciclo para ver os acertos.</BillingEmptyState>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {rowsPagination.totalItems > rowsPagination.pageSize ? (
          <PaginationControls
            className="px-4 pb-3"
            page={rowsPagination.page}
            pageSize={rowsPagination.pageSize}
            totalItems={rowsPagination.totalItems}
            onPageChange={setListPage}
            itemLabel="acertos"
          />
        ) : null}
      </div>

      <Dialog open={newCycleOpen} onOpenChange={setNewCycleOpen}>
        <BillingDialogContent
          title="Novo ciclo de apuração"
          description="Defina período de apuração, pagamento e rótulo operacional do ciclo."
          footer={
            <Button
              className="w-full shadow-md"
              onClick={() => createMut.mutate()}
              disabled={!apuracaoStart || !apuracaoEnd || Boolean(newCycleError) || createMut.isPending}
            >
              {createMut.isPending ? 'Criando…' : 'Criar ciclo'}
            </Button>
          }
        >
          <div className="space-y-3">
            <BillingField label="Rótulo">
              <FormControl value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1 w-full" />
            </BillingField>
            <div className="grid grid-cols-2 gap-3">
              <BillingField label="Apuração início">
                <FormControl type="date" value={apuracaoStart} onChange={(e) => setApuracaoStart(e.target.value)} className="mt-1 w-full" />
              </BillingField>
              <BillingField label="Apuração fim">
                <FormControl type="date" value={apuracaoEnd} onChange={(e) => setApuracaoEnd(e.target.value)} className="mt-1 w-full" />
              </BillingField>
            </div>
            {newCycleError ? <p className="text-xs text-destructive">{newCycleError}</p> : null}
            <BillingField label="Data pagamento">
              <FormControl type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="mt-1 w-full" />
            </BillingField>
            <p className="text-[11px] text-muted-foreground">
              Após criar, a sincronização da API Flux inicia automaticamente para o período de apuração. O resultado
              aparece em Entregas → Notificações de ingestão.
            </p>
          </div>
        </BillingDialogContent>
      </Dialog>
      <Dialog open={Boolean(feedback)} onOpenChange={(open) => !open && setFeedback(null)}>
        {feedback ? (
          <BillingActionFeedbackDialog
            open={Boolean(feedback)}
            onOpenChange={(open) => !open && setFeedback(null)}
            title={feedback.title}
            description={feedback.description}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
