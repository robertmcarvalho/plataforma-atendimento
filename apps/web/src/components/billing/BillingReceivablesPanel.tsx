'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BillingCycleSelect } from '@/components/billing/BillingCycleSelect';
import { BillingCostCenterFilter } from '@/components/billing/BillingCostCenterFilter';
import { BillingPharmacyFilter } from '@/components/billing/BillingPharmacyFilter';
import { BillingEmptyState, BillingField, BillingSection } from '@/components/billing/BillingPrimitives';
import { BillingInvoiceInterestDialog } from '@/components/billing/BillingInvoiceInterestDialog';
import { BillingStatusChips } from '@/components/billing/BillingStatusChips';
import { FormSelect } from '@/components/form/FormSelect';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { billingTableShellClassName } from '@/lib/billing/billingReviveUi';
import { useClientPagination } from '@/lib/billing/billingListUtils';
import {
  fetchBillingCycles,
  fetchBillingInvoices,
  fetchBillingPayments,
  registerInvoicePayment,
  type BillingInvoice,
} from '@/lib/billing/billingApi';
import { pickDefaultOpenCycleId, readCycleParam, replaceQueryIfChanged, writeCycleParam } from '@/lib/billing/billingFilterUrl';
import { formatBrlCents } from '@/lib/billing/billingFormat';
import { billingStatusLabel } from '@/lib/billing/billingLabels';
import { cadastroPageApi } from '@/lib/cadastro/cadastroPageApi';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';
import { canManageBillingFinancial } from '@/lib/billing/billingFinancialAuth';

const ENTITY_META = {
  coop: {
    label: 'CoopMob',
    className: 'border-success/30 bg-success/10 text-success',
  },
  flux: {
    label: 'Flux Farma',
    className: 'border-primary/30 bg-primary/10 text-primary',
  },
} as const;

type ReceivableBucket = 'open' | 'overdue' | 'pending_baixa';
type EntityFilter = 'coop' | 'flux' | '';

const BUCKET_OPTIONS: { id: ReceivableBucket; label: string }[] = [
  { id: 'open', label: 'Em aberto' },
  { id: 'overdue', label: 'Vencidos' },
  { id: 'pending_baixa', label: 'Baixa pendente' },
];

const RECEIVABLES_QUERY_KEY = ['billing', 'invoices', 'receber'] as const;

function invoiceBuckets(
  inv: BillingInvoice,
  pendingByInvoice: Map<string, number>,
  today: string
): ReceivableBucket[] {
  const balance = inv.total_cents - inv.amount_paid_cents;
  const pending = pendingByInvoice.get(inv.id) || 0;
  const buckets: ReceivableBucket[] = [];
  if (inv.status !== 'paid' && balance > 0) buckets.push('open');
  if (inv.due_date && inv.due_date < today && balance > pending) buckets.push('overdue');
  if (pending > 0 && pending < balance) buckets.push('pending_baixa');
  if (pending >= balance && balance > 0) buckets.push('pending_baixa');
  return buckets;
}

export function BillingReceivablesPanel() {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useAuth((s) => s.user);
  const canManage = canManageBillingFinancial(user?.role, user?.permissions);
  const cycleFromUrl = readCycleParam(searchParams);
  const bucketFromUrl = (searchParams.get('bucket') || '') as ReceivableBucket | '';
  const entityFromUrl = (searchParams.get('entity') || '') as EntityFilter;
  const pharmacyFromUrl = searchParams.get('pharmacy_id') || '';
  const costCenterFromUrl = searchParams.get('cost_center_id') || '';
  const includePaidFromUrl = searchParams.get('include_paid') === '1';
  const targetInvoiceId = searchParams.get('invoice_id');

  const [cycleId, setCycleId] = useState(cycleFromUrl);
  const [bucketFilter, setBucketFilter] = useState<ReceivableBucket | ''>(
    bucketFromUrl === 'open' || bucketFromUrl === 'overdue' || bucketFromUrl === 'pending_baixa' ? bucketFromUrl : ''
  );
  const [entityFilter, setEntityFilter] = useState<EntityFilter>(
    entityFromUrl === 'coop' || entityFromUrl === 'flux' ? entityFromUrl : ''
  );
  const [pharmacyId, setPharmacyId] = useState(pharmacyFromUrl);
  const [costCenterId, setCostCenterId] = useState(costCenterFromUrl);
  const [includePaid, setIncludePaid] = useState(includePaidFromUrl || Boolean(targetInvoiceId));
  const [interestInvoice, setInterestInvoice] = useState<BillingInvoice | null>(null);
  /** Deep link ?invoice_id=: adota "Todos os ciclos" uma única vez se a fatura não estiver no ciclo atual. */
  const [cycleAdoptedForTarget, setCycleAdoptedForTarget] = useState(false);
  const targetRowRef = useRef<HTMLTableRowElement | null>(null);

  const cyclesQuery = useQuery({ queryKey: ['billing', 'cycles'], queryFn: fetchBillingCycles });
  const cycles = useMemo(() => cyclesQuery.data || [], [cyclesQuery.data]);

  const invoicesQuery = useQuery({
    queryKey: [...RECEIVABLES_QUERY_KEY, cycleId || 'all'],
    queryFn: () => fetchBillingInvoices(cycleId ? { cycle_id: cycleId } : undefined),
  });
  const paymentsQuery = useQuery({
    queryKey: ['billing', 'payments', 'receber'],
    queryFn: () => fetchBillingPayments(),
  });
  const pharmaciesQuery = useQuery({
    queryKey: ['pharmacies', 'billing-cc-map'],
    queryFn: () =>
      cadastroPageApi.fetchPharmacies({ status: 'active' }) as Promise<
        { id: string; billing_cost_center_id?: string | null }[]
      >,
  });

  const pharmacyCcMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const p of pharmaciesQuery.data || []) map.set(p.id, p.billing_cost_center_id || null);
    return map;
  }, [pharmaciesQuery.data]);

  useEffect(() => {
    if (!cycleFromUrl) return;
    setCycleId((prev) => (prev === cycleFromUrl ? prev : cycleFromUrl));
  }, [cycleFromUrl]);

  useEffect(() => {
    if (cycleId || !cycles.length || cycleAdoptedForTarget) return;
    const preferred = pickDefaultOpenCycleId(cycles);
    if (preferred) setCycleId(preferred);
  }, [cycles, cycleId, cycleAdoptedForTarget]);

  useEffect(() => {
    if (!targetInvoiceId || cycleAdoptedForTarget || !cycleId || invoicesQuery.isLoading) return;
    const found = (invoicesQuery.data || []).some((i) => i.id === targetInvoiceId);
    if (found) return;
    setCycleAdoptedForTarget(true);
    setCycleId('');
  }, [targetInvoiceId, cycleAdoptedForTarget, cycleId, invoicesQuery.data, invoicesQuery.isLoading]);

  useEffect(() => {
    if (targetInvoiceId) setIncludePaid(true);
  }, [targetInvoiceId]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    writeCycleParam(params, cycleId);
    if (bucketFilter) params.set('bucket', bucketFilter);
    else params.delete('bucket');
    if (entityFilter) params.set('entity', entityFilter);
    else params.delete('entity');
    if (pharmacyId) params.set('pharmacy_id', pharmacyId);
    else params.delete('pharmacy_id');
    if (costCenterId) params.set('cost_center_id', costCenterId);
    else params.delete('cost_center_id');
    if (includePaid) params.set('include_paid', '1');
    else params.delete('include_paid');
    replaceQueryIfChanged(router, '/billing/receber', searchParams.toString(), params);
  }, [cycleId, bucketFilter, entityFilter, pharmacyId, costCenterId, includePaid, router, searchParams]);

  const payMut = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) => registerInvoicePayment(id, amount),
    onSettled: async () => {
      await Promise.all([
        qc.refetchQueries({ queryKey: RECEIVABLES_QUERY_KEY, type: 'active' }),
        qc.invalidateQueries({ queryKey: ['billing', 'invoices'] }),
        qc.invalidateQueries({ queryKey: ['billing', 'payments'] }),
        qc.invalidateQueries({ queryKey: ['billing', 'payables'] }),
      ]);
    },
  });

  const pendingByInvoice = useMemo(() => {
    const map = new Map<string, number>();
    for (const payment of paymentsQuery.data || []) {
      if (!payment.invoice_id || payment.reconciled) continue;
      map.set(payment.invoice_id, (map.get(payment.invoice_id) || 0) + payment.amount_cents);
    }
    return map;
  }, [paymentsQuery.data]);

  const today = new Date().toISOString().slice(0, 10);

  const filtered = useMemo(() => {
    let list = invoicesQuery.data || [];
    // A fatura do deep link nunca é escondida pelos filtros padrão.
    const keepFocus = (i: BillingInvoice) => Boolean(targetInvoiceId) && i.id === targetInvoiceId;
    if (!includePaid) {
      list = list.filter((i) => keepFocus(i) || (i.status !== 'paid' && i.amount_paid_cents < i.total_cents));
    }
    if (entityFilter) list = list.filter((i) => keepFocus(i) || i.entity_type === entityFilter);
    if (pharmacyId) list = list.filter((i) => keepFocus(i) || i.pharmacy_id === pharmacyId);
    if (costCenterId) {
      list = list.filter((i) => {
        if (keepFocus(i)) return true;
        const fromJoin = i.pharmacies?.billing_cost_center_id;
        const cc = fromJoin ?? pharmacyCcMap.get(i.pharmacy_id) ?? null;
        return cc === costCenterId;
      });
    }
    if (bucketFilter) {
      list = list.filter((i) => keepFocus(i) || invoiceBuckets(i, pendingByInvoice, today).includes(bucketFilter));
    }

    // Default ordering: overdue first, then open by due_date.
    return [...list].sort((a, b) => {
      const aOverdue = Boolean(a.due_date && a.due_date < today && a.amount_paid_cents < a.total_cents);
      const bOverdue = Boolean(b.due_date && b.due_date < today && b.amount_paid_cents < b.total_cents);
      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
      return String(a.due_date || '').localeCompare(String(b.due_date || ''));
    });
  }, [
    invoicesQuery.data,
    includePaid,
    entityFilter,
    pharmacyId,
    costCenterId,
    bucketFilter,
    pendingByInvoice,
    pharmacyCcMap,
    targetInvoiceId,
    today,
  ]);

  const pagination = useClientPagination(filtered);

  useEffect(() => {
    pagination.resetPage();
  }, [cycleId, bucketFilter, entityFilter, pharmacyId, costCenterId, includePaid]);

  useEffect(() => {
    if (!targetInvoiceId) return;
    const index = filtered.findIndex((i) => i.id === targetInvoiceId);
    if (index < 0) return;
    pagination.setPage(Math.floor(index / pagination.pageSize) + 1);
  }, [filtered, pagination.pageSize, pagination.setPage, targetInvoiceId]);

  useEffect(() => {
    if (!targetInvoiceId) return;
    const el = targetRowRef.current;
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [filtered, pagination.page, targetInvoiceId]);

  return (
    <BillingSection
      title="A receber"
      desc="Títulos em aberto por farmácia, entidade e relatório público."
      icon={ArrowDownToLine}
    >
      <div className="flex flex-wrap items-end gap-3">
        <BillingCycleSelect
          value={cycleId}
          onChange={setCycleId}
          cycles={cycles}
          allowEmpty
          emptyLabel="Todos"
          className="min-w-[220px]"
        />
        <BillingPharmacyFilter value={pharmacyId} onChange={setPharmacyId} className="min-w-[200px]" />
        <BillingCostCenterFilter value={costCenterId} onChange={setCostCenterId} className="min-w-[180px]" />
        <BillingField label="Entidade" className="min-w-[140px]">
          <FormSelect
            className="mt-1 w-full"
            size="sm"
            value={entityFilter}
            onChange={(v) => setEntityFilter(v as EntityFilter)}
            options={[
              { value: '', label: 'Todas' },
              { value: 'coop', label: 'CoopMob' },
              { value: 'flux', label: 'Flux Farma' },
            ]}
          />
        </BillingField>
        <label className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="rounded border-border"
            checked={includePaid}
            onChange={(e) => setIncludePaid(e.target.checked)}
          />
          Incluir pagos
        </label>
      </div>

      <BillingStatusChips
        value={bucketFilter}
        onChange={setBucketFilter}
        options={BUCKET_OPTIONS}
        allLabel="Todos"
      />

      <div className={billingTableShellClassName}>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
            <tr>
              <th className="px-4 py-3">Farmácia</th>
              <th className="px-4 py-3">Entidade</th>
              <th className="px-4 py-3">Vencimento</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Saldo</th>
              <th className="px-4 py-3">Relatório</th>
              <th className="px-4 py-3 text-right">Baixa</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageItems.map((inv) => {
              const balance = inv.total_cents - inv.amount_paid_cents;
              const pending = pendingByInvoice.get(inv.id) || 0;
              const availableForRegistration = Math.max(0, balance - pending);
              const isOverdue = Boolean(inv.due_date && inv.due_date < today && balance > pending);
              const entity = ENTITY_META[inv.entity_type];
              return (
                <tr
                  key={inv.id}
                  ref={inv.id === targetInvoiceId ? targetRowRef : undefined}
                  className={cn(
                    'border-b border-border/40 last:border-0',
                    inv.id === targetInvoiceId && 'bg-primary/10 ring-1 ring-inset ring-primary/30'
                  )}
                >
                  <td className="px-4 py-2.5">{inv.pharmacies?.trade_name || inv.pharmacies?.legal_name || '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${entity.className}`}>
                      {entity.label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs">{inv.due_date || '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{formatBrlCents(inv.total_cents)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">
                    <div>{formatBrlCents(balance)}</div>
                    {pending > 0 ? (
                      <div className="mt-0.5 text-[10px] text-warning">Baixa pendente: {formatBrlCents(pending)}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {inv.entity_type === 'coop' ? (
                      <a className="font-medium text-primary hover:underline" href={`/public/billing/${inv.public_token}`} target="_blank">
                        Abrir relatório
                      </a>
                    ) : (
                      <span className="text-muted-foreground">Incluída no relatório CoopMob</span>
                    )}
                    <div className={isOverdue ? 'text-[10px] text-destructive' : 'text-[10px] text-muted-foreground'}>
                      {pending >= balance && balance > 0
                        ? 'Baixa pendente de conciliação'
                        : isOverdue
                          ? 'Vencida sem baixa conciliada'
                          : billingStatusLabel(inv.status)}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {canManage ? (
                      <div className="flex justify-end gap-2">
                        {inv.status !== 'draft' && inv.status !== 'paid' && balance > pending ? (
                          <Button size="sm" variant="ghost" onClick={() => setInterestInvoice(inv)}>
                            Lançar juros
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={payMut.isPending || availableForRegistration <= 0 || inv.status === 'draft'}
                          onClick={() => payMut.mutate({ id: inv.id, amount: availableForRegistration })}
                        >
                          Registrar baixa
                        </Button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {!filtered.length && !invoicesQuery.isLoading ? (
              <tr>
                <td colSpan={7} className="p-4">
                  <BillingEmptyState>Nenhum título em aberto.</BillingEmptyState>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {pagination.totalItems > pagination.pageSize ? (
          <PaginationControls
            className="px-4 pb-3"
            page={pagination.page}
            pageSize={pagination.pageSize}
            totalItems={pagination.totalItems}
            onPageChange={pagination.setPage}
            itemLabel="títulos"
          />
        ) : null}
      </div>
      {interestInvoice ? (
        <BillingInvoiceInterestDialog
          invoice={interestInvoice}
          open={Boolean(interestInvoice)}
          onOpenChange={(open) => !open && setInterestInvoice(null)}
          onSuccess={() => setInterestInvoice(null)}
        />
      ) : null}
    </BillingSection>
  );
}
