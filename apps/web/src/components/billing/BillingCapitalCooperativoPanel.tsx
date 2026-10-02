'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { BillingEmptyState, BillingField, BillingSection } from '@/components/billing/BillingPrimitives';
import { billingKpiDetailClassName, billingTableShellClassName } from '@/lib/billing/billingReviveUi';
import { fetchCapitalCooperativoReport } from '@/lib/billing/billingApi';
import { formatBrlCents } from '@/lib/billing/billingFormat';
import {
  capitalCoopMovementTypeLabel,
  capitalCoopSourceLabel,
} from '@/lib/billing/billingOperationalLabels';
import {
  downloadSpreadsheet,
  formatSignedBrlCents,
  signedAmountClassName,
  useClientPagination,
} from '@/lib/billing/billingListUtils';
import { cn } from '@/lib/utils';

const CAPITAL_TYPE_OPTIONS = [
  { value: '', label: 'Todos os tipos' },
  { value: 'integralization', label: 'Integralização' },
  { value: 'compensation', label: 'Compensação' },
  { value: 'refund', label: 'Devolução' },
  { value: 'adjustment', label: 'Ajuste' },
  { value: 'reversal', label: 'Estorno' },
  { value: 'advance_recovery', label: 'Adiantamento' },
  { value: 'uniform_recovery', label: 'Uniforme' },
  { value: 'bag_recovery', label: 'Bag / mochila' },
  { value: 'digital_cert_recovery', label: 'Certificado digital' },
  { value: 'other_financial_recovery', label: 'Outras recuperações' },
];

function defaultMonth() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

export function BillingCapitalCooperativoPanel() {
  const searchParams = useSearchParams();
  const monthFromUrl = searchParams.get('month') || '';
  const [month, setMonth] = useState(monthFromUrl || defaultMonth());
  const [driverFilter, setDriverFilter] = useState('');
  const [entryType, setEntryType] = useState('');

  useEffect(() => {
    if (monthFromUrl && monthFromUrl !== month) setMonth(monthFromUrl);
  }, [monthFromUrl, month]);

  const reportQuery = useQuery({
    queryKey: ['billing', 'capital-cooperativo', month],
    queryFn: () => fetchCapitalCooperativoReport(month),
    enabled: Boolean(month),
  });

  const report = reportQuery.data;
  const summary = report?.summary;

  const filteredLines = useMemo(() => {
    const term = driverFilter.trim().toLowerCase();
    return (report?.lines || []).filter((line) => {
      if (entryType && line.entry_type !== entryType) return false;
      if (!term) return true;
      const name = line.driver_name?.toLowerCase() || '';
      return name.includes(term) || line.driver_id.toLowerCase().includes(term);
    });
  }, [report?.lines, driverFilter, entryType]);

  const filteredDrivers = useMemo(() => {
    const term = driverFilter.trim().toLowerCase();
    return (report?.by_driver || []).filter((row) => {
      if (!term) return true;
      const name = row.driver_name?.toLowerCase() || '';
      return name.includes(term) || row.driver_id.toLowerCase().includes(term);
    });
  }, [report?.by_driver, driverFilter]);

  const linesPagination = useClientPagination(filteredLines);
  const driversPagination = useClientPagination(filteredDrivers);

  useEffect(() => {
    linesPagination.resetPage();
    driversPagination.resetPage();
  }, [month, driverFilter, entryType, report?.lines?.length, report?.by_driver?.length]);

  const kpis = useMemo(() => {
    if (!summary) return [];
    const recoveries =
      summary.advance_recovery_cents +
      summary.uniform_recovery_cents +
      summary.bag_recovery_cents +
      summary.digital_cert_recovery_cents +
      summary.other_financial_recovery_cents;
    return [
      { label: 'Integralizações', value: summary.integralization_cents },
      { label: 'Compensações', value: -summary.compensation_cents },
      { label: 'Devoluções', value: -summary.refund_cents },
      { label: 'Recuperações financeiras', value: -recoveries },
      { label: 'Movimento líquido', value: summary.net_movement_cents, emphasis: true },
    ];
  }, [summary]);

  const downloadCsv = () => {
    if (!report) return;
    downloadSpreadsheet(
      `capital-cooperativo-${month}.csv`,
      ['Data', 'Cooperado', 'Origem', 'Tipo', 'Valor (R$)', 'Descrição', 'Ciclo', 'Acerto', 'Desligamento'],
      filteredLines.map((line) => [
        line.movement_date,
        line.driver_name || line.driver_id,
        capitalCoopSourceLabel(line.source),
        capitalCoopMovementTypeLabel(line.source, line.entry_type),
        (line.amount_cents / 100).toFixed(2).replace('.', ','),
        line.description || '',
        line.billing_cycle_id || '',
        line.settlement_id || '',
        line.offboarding_preview_id || '',
      ])
    );
  };

  return (
    <div className="space-y-4">
      <BillingSection
        title="Capital cooperativo"
        desc="Movimentos de cota e recuperações financeiras fora da margem DRE da farmácia."
      >
        <div className="flex flex-wrap items-end gap-3">
          <BillingField label="Competência">
            <FormControl type="month" inputSize="sm" className="mt-1 w-40" value={month} onChange={(e) => setMonth(e.target.value)} />
          </BillingField>
          <BillingField label="Tipo">
            <FormSelect className="mt-1 w-52" size="sm" value={entryType} onChange={setEntryType} options={CAPITAL_TYPE_OPTIONS} />
          </BillingField>
          <BillingField label="Cooperado">
            <FormControl
              type="text"
              inputSize="sm"
              className="mt-1 w-56"
              placeholder="Nome ou ID"
              value={driverFilter}
              onChange={(e) => setDriverFilter(e.target.value)}
            />
          </BillingField>
          <Button size="sm" variant="outline" onClick={() => reportQuery.refetch()} disabled={reportQuery.isFetching}>
            <RefreshCw className={cn('mr-1 h-3.5 w-3.5', reportQuery.isFetching && 'animate-spin')} />
            Atualizar
          </Button>
          <Button size="sm" variant="outline" onClick={downloadCsv} disabled={!filteredLines.length}>
            <Download className="mr-1 h-3.5 w-3.5" /> Exportar Excel
          </Button>
          <Link href="/billing/relatorios" className="text-xs text-primary hover:underline self-center">
            Exportar com mais filtros
          </Link>
        </div>
      </BillingSection>

      {reportQuery.isLoading ? (
        <p className="text-xs text-muted-foreground">Carregando relatório…</p>
      ) : reportQuery.isError ? (
        <p className="text-xs text-destructive">Não foi possível carregar o relatório.</p>
      ) : !report ? null : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {kpis.map((kpi) => (
              <div key={kpi.label} className={billingKpiDetailClassName}>
                <p className="text-[11px] text-muted-foreground">{kpi.label}</p>
                <p className={cn('mt-1 text-sm font-semibold tabular-nums', signedAmountClassName(kpi.value), kpi.emphasis && 'text-base')}>
                  {formatSignedBrlCents(kpi.value)}
                </p>
              </div>
            ))}
          </div>

          <BillingSection title="Por cooperado" desc="Resumo mensal com saldo atual de cotas.">
            <div className={billingTableShellClassName}>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Cooperado</th>
                    <th className="px-3 py-2 font-medium text-right">Integralizado</th>
                    <th className="px-3 py-2 font-medium text-right">Compensado</th>
                    <th className="px-3 py-2 font-medium text-right">Devolvido</th>
                    <th className="px-3 py-2 font-medium text-right">Recuperações</th>
                    <th className="px-3 py-2 font-medium text-right">Líquido mês</th>
                    <th className="px-3 py-2 font-medium text-right">Saldo cotas</th>
                  </tr>
                </thead>
                <tbody>
                  {driversPagination.pageItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                        Nenhum movimento nesta competência.
                      </td>
                    </tr>
                  ) : (
                    driversPagination.pageItems.map((row) => (
                      <tr key={row.driver_id} className="border-b border-border/60">
                        <td className="px-3 py-2">{row.driver_name || row.driver_id.slice(0, 8)}</td>
                        <td className={cn('px-3 py-2 text-right tabular-nums', signedAmountClassName(row.integralization_cents))}>
                          {formatSignedBrlCents(row.integralization_cents)}
                        </td>
                        <td className={cn('px-3 py-2 text-right tabular-nums', signedAmountClassName(-row.compensation_cents))}>
                          {row.compensation_cents ? formatSignedBrlCents(-row.compensation_cents) : '—'}
                        </td>
                        <td className={cn('px-3 py-2 text-right tabular-nums', signedAmountClassName(-row.refund_cents))}>
                          {row.refund_cents ? formatSignedBrlCents(-row.refund_cents) : '—'}
                        </td>
                        <td className={cn('px-3 py-2 text-right tabular-nums', signedAmountClassName(-row.financial_recovery_cents))}>
                          {row.financial_recovery_cents ? formatSignedBrlCents(-row.financial_recovery_cents) : '—'}
                        </td>
                        <td className={cn('px-3 py-2 text-right tabular-nums font-medium', signedAmountClassName(row.net_movement_cents))}>
                          {formatSignedBrlCents(row.net_movement_cents)}
                        </td>
                        <td className={cn('px-3 py-2 text-right tabular-nums', signedAmountClassName(row.quota_balance_cents))}>
                          {formatBrlCents(row.quota_balance_cents)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <PaginationControls
                className="px-3"
                page={driversPagination.page}
                pageSize={driversPagination.pageSize}
                totalItems={driversPagination.totalItems}
                onPageChange={driversPagination.setPage}
                itemLabel="cooperados"
              />
            </div>
          </BillingSection>

          <BillingSection title="Extrato detalhado" desc="Linhas de cotas e recuperações financeiras cooperativas.">
            {filteredLines.length === 0 ? (
              <BillingEmptyState title="Sem movimentos" description="Não há lançamentos para os filtros selecionados." />
            ) : (
              <div className={billingTableShellClassName}>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Data</th>
                      <th className="px-3 py-2 font-medium">Cooperado</th>
                      <th className="px-3 py-2 font-medium">Origem</th>
                      <th className="px-3 py-2 font-medium">Tipo</th>
                      <th className="px-3 py-2 font-medium text-right">Valor</th>
                      <th className="px-3 py-2 font-medium">Descrição</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linesPagination.pageItems.map((line) => (
                      <tr key={`${line.source}-${line.id}`} className="border-b border-border/60">
                        <td className="px-3 py-2 whitespace-nowrap">{line.movement_date}</td>
                        <td className="px-3 py-2">{line.driver_name || line.driver_id.slice(0, 8)}</td>
                        <td className="px-3 py-2">{capitalCoopSourceLabel(line.source)}</td>
                        <td className="px-3 py-2">{capitalCoopMovementTypeLabel(line.source, line.entry_type)}</td>
                        <td className={cn('px-3 py-2 text-right tabular-nums font-medium', signedAmountClassName(line.amount_cents))}>
                          {formatSignedBrlCents(line.amount_cents)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{line.description || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <PaginationControls
                  className="px-3"
                  page={linesPagination.page}
                  pageSize={linesPagination.pageSize}
                  totalItems={linesPagination.totalItems}
                  onPageChange={linesPagination.setPage}
                  itemLabel="movimentos"
                />
              </div>
            )}
          </BillingSection>
        </>
      )}
    </div>
  );
}
