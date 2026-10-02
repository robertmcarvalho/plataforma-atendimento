'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Download, Lock, LockOpen, RefreshCw, Settings, TrendingDown, TrendingUp } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button, buttonVariants } from '@/components/ui/button';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { BillingField, BillingSection } from '@/components/billing/BillingPrimitives';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { cn } from '@/lib/utils';
import {
  BILLING_DRE_CUTOVER_MONTH,
  closeDrePeriod,
  downloadDreCsv,
  fetchCostCenters,
  fetchBillingPayments,
  fetchDreReport,
  recalculateDre,
  reopenDrePeriod,
} from '@/lib/billing/billingApi';
import { formatBrlCents } from '@/lib/billing/billingFormat';
import { signedAmountClassName, useClientPagination } from '@/lib/billing/billingListUtils';
import {
  billingKpiDetailClassName,
  billingSegmentButton,
  billingSegmentShellClassName,
  billingTableShellClassName,
} from '@/lib/billing/billingReviveUi';
import {
  chartAxisStroke,
  chartColor,
  chartGridStroke,
  chartLegendStyle,
  chartTickProps,
  chartTooltipStyle,
} from '@/lib/chartTheme';
import { useAuth } from '@/store/auth';
import { canManageBillingFinancial } from '@/lib/billing/billingFinancialAuth';

function defaultMonth() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  const prev = d.toISOString().slice(0, 7);
  return prev < BILLING_DRE_CUTOVER_MONTH ? BILLING_DRE_CUTOVER_MONTH : prev;
}

function lineTone(kind: string, cents: number) {
  if (kind === 'revenue') return 'text-success';
  if (kind === 'result') return cn(cents >= 0 ? 'text-success font-semibold' : 'text-destructive font-semibold');
  if (kind === 'tax' || kind === 'variable_cost' || kind === 'fixed_cost') return 'text-foreground';
  return '';
}

export function BillingDrePanel() {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useAuth((s) => s.user);
  const canManage = canManageBillingFinancial(user?.role, user?.permissions);
  const monthFromUrl = searchParams.get('month') || '';
  const entityFromUrl = searchParams.get('entity');
  const costCenterFromUrl = searchParams.get('cost_center_id') || '';
  const [month, setMonth] = useState(monthFromUrl || defaultMonth());
  const [entity, setEntity] = useState<'coop' | 'flux'>(
    entityFromUrl === 'coop' || entityFromUrl === 'flux' ? entityFromUrl : 'flux'
  );
  const [costCenterId, setCostCenterId] = useState(costCenterFromUrl);
  const [tab, setTab] = useState<'consolidated' | 'pharmacies' | 'cost_centers' | 'management'>('consolidated');

  useEffect(() => {
    if (monthFromUrl && monthFromUrl !== month) setMonth(monthFromUrl);
  }, [monthFromUrl, month]);

  useEffect(() => {
    if ((entityFromUrl === 'coop' || entityFromUrl === 'flux') && entityFromUrl !== entity) {
      setEntity(entityFromUrl);
    }
  }, [entityFromUrl, entity]);

  const syncUrl = (nextMonth: string, nextEntity: 'coop' | 'flux', nextCostCenterId = costCenterId) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('month', nextMonth);
    params.set('entity', nextEntity);
    if (nextCostCenterId) params.set('cost_center_id', nextCostCenterId);
    else params.delete('cost_center_id');
    router.replace(`/billing/dre?${params.toString()}`, { scroll: false });
  };

  const costCentersQuery = useQuery({
    queryKey: ['billing', 'cost-centers', 'active'],
    queryFn: () => fetchCostCenters(true),
  });

  const reportQuery = useQuery({
    queryKey: ['billing', 'dre', entity, month, costCenterId],
    queryFn: () => fetchDreReport(entity, month, costCenterId || null),
    enabled: !!month,
  });
  const pendingPaymentsQuery = useQuery({
    queryKey: ['billing', 'payments', 'dre-pending'],
    queryFn: () => fetchBillingPayments({ reconciled: false }),
  });

  const recalcMut = useMutation({
    mutationFn: () => recalculateDre(entity, month),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing', 'dre', entity, month] }),
  });

  const closeMut = useMutation({
    mutationFn: () => closeDrePeriod(entity, month),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing', 'dre', entity, month] }),
  });

  const reopenMut = useMutation({
    mutationFn: () => reopenDrePeriod(entity, month),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing', 'dre', entity, month] }),
  });

  const report = reportQuery.data;
  const isClosed = report?.period_status === 'closed';
  const pharmaciesPagination = useClientPagination(report?.pharmacies || []);
  const costCentersPagination = useClientPagination(report?.cost_centers || []);

  useEffect(() => {
    pharmaciesPagination.resetPage();
    costCentersPagination.resetPage();
  }, [month, entity, tab]);

  const kpis = useMemo(() => {
    if (!report) return null;
    return [
      { label: 'Receita', value: report.revenue_cents, icon: TrendingUp, tone: 'text-success' },
      { label: 'Operacional', value: report.operational_cost_cents || report.variable_cost_cents, icon: TrendingDown, tone: 'text-muted-foreground' },
      { label: 'Administrativo', value: report.administrative_expense_cents || report.fixed_cost_cents, icon: TrendingDown, tone: 'text-muted-foreground' },
      { label: 'Impostos', value: report.tax_cents, icon: TrendingDown, tone: 'text-warning' },
      { label: 'Resultado', value: report.result_cents, icon: report.result_cents >= 0 ? TrendingUp : TrendingDown, tone: report.result_cents >= 0 ? 'text-success' : 'text-destructive' },
    ];
  }, [report]);

  const costBreakdown = useMemo(() => {
    if (!report) return [];
    return [
      { name: 'Operacional', value: Math.abs(report.operational_cost_cents || report.variable_cost_cents) },
      { name: 'Administrativo', value: Math.abs(report.administrative_expense_cents || 0) },
      { name: 'Comercial', value: Math.abs(report.commercial_expense_cents || 0) },
      { name: 'Financeiro', value: Math.abs(report.financial_expense_cents || 0) },
      { name: 'Impostos', value: Math.abs(report.tax_cents) },
    ].filter((d) => d.value > 0);
  }, [report]);

  const pharmacyChart = useMemo(() => {
    if (!report?.pharmacies?.length) return [];
    return [...report.pharmacies]
      .sort((a, b) => b.revenue_cents - a.revenue_cents)
      .slice(0, 8)
      .map((p) => ({
        name: p.pharmacy_name.length > 18 ? `${p.pharmacy_name.slice(0, 16)}…` : p.pharmacy_name,
        receita: p.revenue_cents / 100,
        resultado: p.result_cents / 100,
      }));
  }, [report]);

  const fmtChartBrl = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

  const downloadCsv = async () => {
    const csv = await downloadDreCsv(entity, month, costCenterId || null);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dre-${entity}-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <BillingSection
        title="Filtros e fechamento"
        desc={`DRE gerencial por competência. Cutover oficial: ${BILLING_DRE_CUTOVER_MONTH}. CoopMob e Flux Farma são apurados separadamente.`}
      >
        <div className="flex flex-wrap items-end gap-3">
        <BillingField label="Competência">
          <FormControl
            type="month"
            inputSize="sm"
            min={BILLING_DRE_CUTOVER_MONTH}
            className="mt-1 w-36"
            value={month}
            onChange={(e) => {
              const v = e.target.value;
              setMonth(v);
              syncUrl(v, entity);
            }}
          />
        </BillingField>
        <BillingField label="Entidade">
          <FormSelect
            className="mt-1 w-40"
            size="sm"
            value={entity}
            onChange={(value) => {
              const v = value as 'coop' | 'flux';
              setEntity(v);
              syncUrl(month, v);
            }}
            options={[
              { value: 'coop', label: 'CoopMob' },
              { value: 'flux', label: 'Flux Farma' },
            ]}
          />
        </BillingField>
        <BillingField label="Centro de custo">
          <FormSelect
            className="mt-1 w-64"
            size="sm"
            value={costCenterId}
            onChange={(value) => {
              setCostCenterId(value);
              syncUrl(month, entity, value);
            }}
            options={[
              { value: '', label: 'Todos' },
              ...(costCentersQuery.data || [])
                .filter((cc) => !cc.corporate_entity_type || cc.corporate_entity_type === entity)
                .map((cc) => ({ value: cc.id, label: cc.name })),
            ]}
          />
        </BillingField>
        {canManage ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => recalcMut.mutate()}
            disabled={recalcMut.isPending || isClosed || report?.before_cutover}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Recalcular
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => void downloadCsv()} disabled={!report || report.before_cutover}>
          <Download className="mr-1 h-3.5 w-3.5" /> Exportar CSV
        </Button>
        {canManage ? (
          <Link href="/billing/config?tab=impostos-dre" className={buttonVariants({ size: 'sm', variant: 'ghost' })}>
            <Settings className="mr-1 h-3.5 w-3.5" /> Alíquotas
          </Link>
        ) : null}
        {canManage ? (
          <Link href={`/billing/capital-cooperativo?month=${month}`} className={buttonVariants({ size: 'sm', variant: 'ghost' })}>
            Capital cooperativo
          </Link>
        ) : null}
        {canManage && isClosed ? (
          <Button size="sm" variant="outline" onClick={() => reopenMut.mutate()} disabled={reopenMut.isPending}>
            <LockOpen className="mr-1 h-3.5 w-3.5" /> Reabrir período
          </Button>
        ) : null}
        {canManage && !isClosed ? (
          <Button
            size="sm"
            onClick={() => closeMut.mutate()}
            disabled={closeMut.isPending || report?.before_cutover || !report}
          >
            <Lock className="mr-1 h-3.5 w-3.5" /> Fechar período
          </Button>
        ) : null}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Impostos provisionados na competência da receita; INSS Coop usa a base do relatório INSS.
        </p>
      </BillingSection>

      {report?.period_status === 'closed' ? (
        <p className="text-xs font-medium text-warning">Período fechado — recálculo bloqueado.</p>
      ) : null}

      {(report?.warnings || []).map((w) => (
        <p key={w} className="text-xs text-warning">
          {w}
        </p>
      ))}

      {report && ((report.warnings || []).length > 0 || (pendingPaymentsQuery.data || []).length > 0) ? (
        <BillingSection
          title="Pendências gerenciais"
          desc="Itens que podem distorcer o DRE ou impedir fechamento operacional confiável."
        >
          <div className="space-y-2 text-xs">
            {(report.warnings || []).map((warning) => (
              <div key={warning} className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-warning">
                {warning}
              </div>
            ))}
            {(pendingPaymentsQuery.data || []).slice(0, 8).map((payment) => (
              <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
                <span>
                  Baixa pendente de conciliação: {formatBrlCents(payment.amount_cents)}
                  {payment.invoice_id ? ' · A receber' : payment.payable_id ? ' · A pagar' : ''}
                </span>
                <Link className="font-medium text-primary hover:underline" href="/billing/conciliacao">
                  Ir para conciliação
                </Link>
              </div>
            ))}
            {(pendingPaymentsQuery.data || []).length > 8 ? (
              <p className="text-muted-foreground">Há mais baixas pendentes em Conciliação.</p>
            ) : null}
          </div>
        </BillingSection>
      ) : null}

      {kpis ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {kpis.map((k) => (
            <div key={k.label} className={billingKpiDetailClassName}>
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase tracking-wider text-subtle-foreground">{k.label}</p>
                <k.icon className={cn('h-3.5 w-3.5', k.tone)} />
              </div>
              <p className={cn('mt-2 font-mono text-lg font-semibold', k.tone)}>{formatBrlCents(k.value)}</p>
            </div>
          ))}
        </div>
      ) : null}

      {report && !report.before_cutover ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className={billingKpiDetailClassName}>
            <h3 className="mb-3 text-sm font-semibold">Composição de custos</h3>
            {costBreakdown.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={costBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80}>
                    {costBreakdown.map((_, i) => (
                      <Cell key={i} fill={chartColor(i)} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v) => fmtChartBrl(Number(v || 0) / 100)}
                    contentStyle={chartTooltipStyle}
                  />
                  <Legend wrapperStyle={chartLegendStyle} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-muted-foreground">Sem custos nesta competência.</p>
            )}
          </div>

          <div className={billingKpiDetailClassName}>
            <h3 className="mb-3 text-sm font-semibold">Receita × resultado por farmácia</h3>
            {pharmacyChart.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={pharmacyChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={chartGridStroke} strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={chartTickProps} stroke={chartAxisStroke} interval={0} angle={-25} textAnchor="end" height={56} />
                  <YAxis tick={chartTickProps} stroke={chartAxisStroke} tickFormatter={(v) => fmtChartBrl(Number(v))} width={72} />
                  <Tooltip formatter={(v) => fmtChartBrl(Number(v || 0))} contentStyle={chartTooltipStyle} />
                  <Legend wrapperStyle={chartLegendStyle} />
                  <Bar dataKey="receita" name="Receita" fill={chartColor(0)} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="resultado" name="Resultado" fill={chartColor(2)} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-muted-foreground">Sem dados por farmácia.</p>
            )}
          </div>
        </div>
      ) : null}

      <div className={billingSegmentShellClassName}>
        {(
          [
            ['consolidated', 'Consolidado'],
            ['pharmacies', 'Por farmácia'],
            ['cost_centers', 'Por centro de custo'],
            ['management', 'Adm. x Operacional'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={billingSegmentButton(tab === id)}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'consolidated' && report ? (
        <div className={billingTableShellClassName}>
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
              <tr>
                <th className="px-4 py-3">Conta</th>
                <th className="px-4 py-3 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {report.consolidated.map((line) => (
                <tr key={line.account_code} className="border-b border-border/40 last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs text-muted-foreground">{line.account_code}</span>{' '}
                    {line.account_name}
                  </td>
                  <td className={cn('px-4 py-2.5 text-right font-mono text-xs', lineTone(line.line_kind, line.amount_cents))}>
                    {formatBrlCents(line.amount_cents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'pharmacies' && report ? (
        <div className={billingTableShellClassName}>
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
              <tr>
                <th className="px-4 py-3">Farmácia</th>
                <th className="px-4 py-3">CC</th>
                <th className="px-4 py-3 text-right">Receita</th>
                <th className="px-4 py-3 text-right">CV</th>
                <th className="px-4 py-3 text-right">CF</th>
                <th className="px-4 py-3 text-right">Imposto</th>
                <th className="px-4 py-3 text-right">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {pharmaciesPagination.pageItems.map((p) => (
                <tr key={p.pharmacy_id} className="border-b border-border/40 last:border-0">
                  <td className="px-4 py-2.5">{p.pharmacy_name}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{p.cost_center_name || '—'}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{formatBrlCents(p.revenue_cents)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{formatBrlCents(p.variable_cost_cents)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{formatBrlCents(p.fixed_cost_cents)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{formatBrlCents(p.tax_cents)}</td>
                  <td
                    className={cn(
                      'px-4 py-2.5 text-right font-mono text-xs font-medium',
                      signedAmountClassName(p.result_cents)
                    )}
                  >
                    {formatBrlCents(p.result_cents)}
                  </td>
                </tr>
              ))}
              {!report.pharmacies.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-xs text-muted-foreground">
                    Sem dados para esta competência.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {pharmaciesPagination.totalItems > pharmaciesPagination.pageSize ? (
            <PaginationControls
              className="px-4 pb-3"
              page={pharmaciesPagination.page}
              pageSize={pharmaciesPagination.pageSize}
              totalItems={pharmaciesPagination.totalItems}
              onPageChange={pharmaciesPagination.setPage}
              itemLabel="farmácias"
            />
          ) : null}
        </div>
      ) : null}

      {tab === 'cost_centers' && report ? (
        <div className={billingTableShellClassName}>
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
              <tr>
                <th className="px-4 py-3">Centro de custo</th>
                <th className="px-4 py-3 text-right">Farmácias</th>
                <th className="px-4 py-3 text-right">Receita</th>
                <th className="px-4 py-3 text-right">CV</th>
                <th className="px-4 py-3 text-right">CF</th>
                <th className="px-4 py-3 text-right">Imposto</th>
                <th className="px-4 py-3 text-right">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {costCentersPagination.pageItems.map((cc) => (
                <tr key={cc.cost_center_id} className="border-b border-border/40 last:border-0">
                  <td className="px-4 py-2.5">{cc.cost_center_name}</td>
                  <td className="px-4 py-2.5 text-right text-xs">{cc.pharmacy_count}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{formatBrlCents(cc.revenue_cents)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{formatBrlCents(cc.variable_cost_cents)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{formatBrlCents(cc.fixed_cost_cents)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{formatBrlCents(cc.tax_cents)}</td>
                  <td
                    className={cn(
                      'px-4 py-2.5 text-right font-mono text-xs font-medium',
                      signedAmountClassName(cc.result_cents)
                    )}
                  >
                    {formatBrlCents(cc.result_cents)}
                  </td>
                </tr>
              ))}
              {!report.cost_centers?.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-xs text-muted-foreground">
                    Sem dados agregados por centro de custo.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {costCentersPagination.totalItems > costCentersPagination.pageSize ? (
            <PaginationControls
              className="px-4 pb-3"
              page={costCentersPagination.page}
              pageSize={costCentersPagination.pageSize}
              totalItems={costCentersPagination.totalItems}
              onPageChange={costCentersPagination.setPage}
              itemLabel="centros de custo"
            />
          ) : null}
        </div>
      ) : null}

      {tab === 'management' && report ? (
        <div className={billingTableShellClassName}>
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
              <tr>
                <th className="px-4 py-3">Natureza</th>
                <th className="px-4 py-3 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Custo operacional', report.management_summary?.operational_cost_cents ?? report.operational_cost_cents ?? 0],
                ['Despesa administrativa', report.management_summary?.administrative_expense_cents ?? report.administrative_expense_cents ?? 0],
                ['Despesa comercial', report.management_summary?.commercial_expense_cents ?? report.commercial_expense_cents ?? 0],
                ['Despesa financeira', report.management_summary?.financial_expense_cents ?? report.financial_expense_cents ?? 0],
                ['Impostos', report.tax_cents],
                ['Resultado operacional', report.management_summary?.result_operational_cents ?? report.result_cents],
                ['Resultado líquido gerencial', report.management_summary?.result_net_cents ?? report.result_cents],
              ].map(([label, value]) => (
                <tr key={String(label)} className="border-b border-border/40 last:border-0">
                  <td className="px-4 py-2.5">{label}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{formatBrlCents(Number(value))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

