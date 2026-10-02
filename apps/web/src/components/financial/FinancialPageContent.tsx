'use client';

import {
  AlertCircle,
  Download,
  FileSpreadsheet,
  Plus,
  RefreshCw,
  Settings2,
  UserX,
  Wallet,
} from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { OccurrenceWizard } from '@/components/occurrences/OccurrenceWizard';
import { ApprovalDrawer } from '@/components/financial/ApprovalDrawer';
import { DiscountRulesModal } from '@/components/financial/DiscountRulesModal';
import { FinancialFilters } from '@/components/financial/FinancialFilters';
import { FinancialKpiCards } from '@/components/financial/FinancialKpiCards';
import { FinancialTable } from '@/components/financial/FinancialTable';
import { ImportBillingModal } from '@/components/financial/ImportBillingModal';
import { NewEntryModal } from '@/components/financial/NewEntryModal';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/PageHeader';
import { EntryTypesProvider } from '@/lib/financial/entryTypesContext';
import { conferenceDayLabels, WEEK_DAY_LABELS } from '@/lib/financial/financialLabels';
import type { FinancialPageController } from '@/lib/financial/useFinancialPageController';
import { isDailyExclusiveConferenceDay, isDailyPaymentConferenceDay } from '@/lib/financialCycle';
import { downloadPixBatchExport, exportDailyPixBatch } from '@/lib/billing/billingApi';
import { exportFinancialDailiesXlsx } from '@/lib/financial/financialExportApi';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { reviveOutlineButtonClassName } from '@/lib/reviveSurfaces';
import { cn } from '@/lib/utils';

export function FinancialPageContent({
  state,
  summary,
  mutations,
  canRegisterOccurrence,
  canApprove,
  clearFilters,
  togglePendingApprovalFilter,
  selectEntry,
}: FinancialPageController) {
  const { conferenceWeekdayUi, discountRules, stats, entryTypesCtx, selectedCycleStart } = summary;

  const exportDailiesMut = useMutation({
    mutationFn: () =>
      exportDailyPixBatch({
        payment_date: selectedCycleStart,
        sync_payables: true,
      }),
    onSuccess: (data) => downloadPixBatchExport(data),
  });

  const exportDailiesReportMut = useMutation({
    mutationFn: () =>
      exportFinancialDailiesXlsx({
        payment_date: selectedCycleStart,
        pharmacy_id: state.pharmacyFilter || undefined,
        leader_id: state.leaderFilter || undefined,
        driver_id: state.driverFilter || undefined,
        status: state.statusFilter !== 'all' ? state.statusFilter : undefined,
        installment_status: state.installmentFilter,
      }),
  });

  const showDailyPixExport =
    conferenceWeekdayUi !== null &&
    isDailyPaymentConferenceDay(conferenceWeekdayUi, discountRules);

  return (
    <EntryTypesProvider value={entryTypesCtx}>
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-7xl px-8 py-8">
          <PageHeader
            icon={Wallet}
            live
            eyebrow="Financeiro"
            title="Gestão de Ciclos e Descontos"
            description="Acompanhe faturamento, cotas e pagamentos semanais."
            actions={
              <>
                <Button
                  size="xs"
                  variant="outline"
                  className="shadow-sm"
                  disabled={exportDailiesReportMut.isPending || !selectedCycleStart}
                  title="Planilha XLS com todas as diárias do lote/filtros atuais"
                  onClick={() => exportDailiesReportMut.mutate()}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  {exportDailiesReportMut.isPending ? 'Gerando…' : 'Exportar diárias (XLS)'}
                </Button>
                {showDailyPixExport ? (
                  <Button
                    size="xs"
                    variant="outline"
                    className="shadow-sm"
                    disabled={exportDailiesMut.isPending || !selectedCycleStart}
                    title="Exporta C6 das diárias aprovadas com parcela nesta data"
                    onClick={() => exportDailiesMut.mutate()}
                  >
                    <Download className="h-3.5 w-3.5" />
                    {exportDailiesMut.isPending ? 'Exportando…' : 'Exportar PIX diárias'}
                  </Button>
                ) : null}
                <button onClick={() => state.setShowImport(true)} className={reviveOutlineButtonClassName}>
                  <FileSpreadsheet className="h-3.5 w-3.5 text-success" /> Importar Faturamento
                </button>
                <button onClick={() => state.setShowRules(true)} className={reviveOutlineButtonClassName}>
                  <Settings2 className="h-3.5 w-3.5" /> Configuração regras lançamento
                </button>
                <button
                  onClick={() => void summary.refetch()}
                  disabled={summary.isFetching}
                  className={reviveOutlineButtonClassName}
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', summary.isFetching && 'animate-spin')} /> Atualizar
                </button>
                {canRegisterOccurrence ? (
                  <button onClick={() => state.setShowOccurrence(true)} className={reviveOutlineButtonClassName}>
                    <UserX className="h-3.5 w-3.5" /> Ocorrência de escala
                  </button>
                ) : null}
                <Button size="xs" className="shadow-md" onClick={() => state.setShowNew(true)}>
                  <Plus className="h-3.5 w-3.5" /> Novo lançamento
                </Button>
              </>
            }
          />

          <FinancialKpiCards stats={stats} onTogglePendingApproval={togglePendingApprovalFilter} />

          {conferenceWeekdayUi === null ? (
            <div className="mb-4 flex gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
              <AlertCircle className="h-5 w-5 shrink-0 text-warning" />
              <div>
                <p className="font-medium text-foreground">Selecione um dia de pagamento configurado</p>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  Dias válidos para conferência: <strong>{conferenceDayLabels(discountRules) || '—'}</strong>. Em dias só de
                  diária (ex.: terça), aparecem apenas <strong>créditos de diária</strong>. No dia de liquidação (ex.:
                  quinta), entram diárias e <strong>descontos</strong> com parcela nesta data. Outras datas exibem a lista
                  sem filtro de lote; KPIs do ciclo ficam zerados.
                </p>
              </div>
            </div>
          ) : (
            <p className="mb-3 text-xs text-muted-foreground">
              {stats.openInCycle > 0 ? (
                <span className="mr-2 inline-flex rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 font-semibold text-warning">
                  {stats.openInCycle} em aberto neste ciclo (aguardando baixa)
                </span>
              ) : null}
              {isDailyExclusiveConferenceDay(conferenceWeekdayUi, discountRules) ? (
                <>
                  <span className="font-semibold text-foreground">
                    Conferência {WEEK_DAY_LABELS[conferenceWeekdayUi]}:
                  </span>{' '}
                  somente diárias com pagamento nesta data (corte {discountRules.daily?.submissionCutoffHour ?? 11}h).{' '}
                  <Link href="/billing/relatorios/pagamento-pix-diarias" className="text-primary underline underline-offset-2">
                    Abrir lote PIX diárias no Faturamento
                  </Link>
                </>
              ) : (
                <>
                  <span className="font-semibold text-foreground">
                    Conferência {WEEK_DAY_LABELS[conferenceWeekdayUi]}:
                  </span>{' '}
                  diárias e descontos com vencimento nesta data, conforme regras configuradas.
                  {isDailyPaymentConferenceDay(conferenceWeekdayUi, discountRules) ? (
                    <>
                      {' '}
                      <Link href="/billing/relatorios/pagamento-pix-diarias" className="text-primary underline underline-offset-2">
                        Abrir lote PIX diárias no Faturamento
                      </Link>
                    </>
                  ) : null}
                </>
              )}
            </p>
          )}

          {exportDailiesMut.isError ? (
            <p className="mb-3 text-sm text-destructive">
              {(exportDailiesMut.error as Error)?.message || 'Não foi possível exportar o PIX de diárias.'}
            </p>
          ) : null}
          {exportDailiesReportMut.isError ? (
            <p className="mb-3 text-sm text-destructive">
              {apiErrorMessage(exportDailiesReportMut.error, 'Não foi possível exportar o relatório de diárias.')}
            </p>
          ) : null}

          <FinancialFilters
            search={state.search}
            onSearchChange={state.setSearch}
            selectedCycleStart={summary.selectedCycleStart}
            onSelectedCycleStartChange={summary.setSelectedCycleStart}
            leaderFilter={state.leaderFilter}
            onLeaderFilterChange={state.setLeaderFilter}
            leadersList={summary.leadersList}
            pharmacyFilter={state.pharmacyFilter}
            onPharmacyFilterChange={state.setPharmacyFilter}
            pharmaciesList={summary.pharmaciesList}
            installmentFilter={state.installmentFilter}
            onInstallmentFilterChange={state.setInstallmentFilter}
            typeFilter={state.typeFilter}
            onTypeFilterChange={state.setTypeFilter}
            typeLabels={entryTypesCtx.labels}
            statusFilter={state.statusFilter}
            onTogglePendingApproval={togglePendingApprovalFilter}
            hasActiveFilters={summary.hasActiveFilters(state.search)}
            onClearFilters={clearFilters}
          />

          <FinancialTable
            isLoading={summary.isLoading}
            entries={summary.finalFiltered}
            typeLabels={entryTypesCtx.labels}
            selectedCycleStart={summary.selectedCycleStart}
            conferenceWeekdayUi={conferenceWeekdayUi}
            coverageMaps={summary.coverageMaps}
            onSelectEntry={selectEntry}
          />
        </div>

        {state.showNew ? (
          <NewEntryModal
            onClose={() => {
              state.setShowNew(false);
              if (state.advanceApprovalMode.enabled) state.router.replace('/financial');
            }}
            onCreated={() => {
              void summary.refetch();
              if (state.advanceApprovalMode.enabled) state.router.replace('/financial');
            }}
            approvalMode={state.advanceApprovalMode}
          />
        ) : null}
        {state.showImport ? (
          <ImportBillingModal onClose={() => state.setShowImport(false)} onImported={() => void summary.refetch()} />
        ) : null}
        {state.showRules ? (
          <DiscountRulesModal
            rules={discountRules}
            onClose={() => state.setShowRules(false)}
            onSave={(r) => void mutations.saveDiscountRules(r)}
          />
        ) : null}
        {state.showOccurrence && canRegisterOccurrence ? (
          <OccurrenceWizard
            mode="financial"
            layout="modal"
            drivers={summary.occurrenceDrivers || []}
            pharmacies={summary.pharmaciesList || []}
            driversLoading={summary.occurrenceDriversLoading}
            onCancel={() => state.setShowOccurrence(false)}
            onSuccess={() => {
              state.setShowOccurrence(false);
              void summary.refetch();
            }}
          />
        ) : null}
        {state.selectedId ? (
          <ApprovalDrawer
            key={state.selectedId}
            id={state.selectedId}
            fallbackEntry={state.selectedEntry}
            discountRules={discountRules}
            canApprove={canApprove}
            coverageMaps={summary.coverageMaps}
            onOpenEntry={mutations.openLinkedEntry}
            onClose={() => {
              state.setSelectedId(null);
              state.setSelectedEntry(null);
            }}
            onRefresh={() => void summary.refetch()}
          />
        ) : null}
      </div>
    </EntryTypesProvider>
  );
}
