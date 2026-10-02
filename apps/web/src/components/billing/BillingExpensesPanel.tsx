'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Coins, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { BillingDialogContent, BillingEmptyState, BillingField, BillingSection, BillingSwitchRow } from '@/components/billing/BillingPrimitives';
import { PaginationControls } from '@/components/ui/PaginationControls';
import {
  fetchBillingExpenses,
  fetchCostCenters,
  fetchExpenseTypes,
  fetchInternalProviders,
  saveBillingExpense,
} from '@/lib/billing/billingApi';
import { formatBrlCents, fmtDate } from '@/lib/billing/billingFormat';
import { useClientPagination } from '@/lib/billing/billingListUtils';
import { billingSegmentButton, billingSegmentShellClassName } from '@/lib/billing/billingReviveUi';
import { billingTableShellClassName } from '@/lib/billing/billingReviveUi';
import { BillingEntityBadge } from '@/components/billing/BillingEntityBadge';
import { BillingRateioEditor } from '@/components/billing/BillingRateioEditor';
import {
  BillingProviderAllocationEditor,
  providerAllocationToRecord,
  type ProviderAllocationLine,
} from '@/components/billing/BillingProviderAllocationEditor';
import {
  divideEqual,
  rateioToAllocation,
  validateRateio,
  type RateioLine,
} from '@/lib/billing/billingRateio';

export function BillingExpensesPanel() {
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState<'todas' | 'fixa' | 'variavel'>('todas');
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [expenseTypeId, setExpenseTypeId] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [entityType, setEntityType] = useState<'coop' | 'flux' | 'both'>('flux');
  const [recurrence, setRecurrence] = useState('');
  const [useRateio, setUseRateio] = useState(false);
  const [rateioLines, setRateioLines] = useState<RateioLine[]>([]);
  const [providerLines, setProviderLines] = useState<ProviderAllocationLine[]>([]);

  const expensesQuery = useQuery({ queryKey: ['billing', 'expenses'], queryFn: fetchBillingExpenses });
  const typesQuery = useQuery({ queryKey: ['billing', 'expense-types'], queryFn: fetchExpenseTypes });
  const ccQuery = useQuery({ queryKey: ['billing', 'cost-centers', 'active'], queryFn: () => fetchCostCenters(true) });
  const providersQuery = useQuery({
    queryKey: ['billing', 'internal-providers', 'active'],
    queryFn: () => fetchInternalProviders(true),
  });

  const amountCents = Math.round(Number(amount.replace(',', '.')) * 100) || 0;
  const selectedType = (typesQuery.data || []).find((t) => t.id === expenseTypeId);
  const perProvider = selectedType?.allocation_mode === 'per_provider';

  const rateioValid = useMemo(() => {
    if (perProvider) {
      if (!providerLines.length) return true;
      return providerLines.reduce((s, l) => s + l.amount_cents, 0) === amountCents;
    }
    return !useRateio || validateRateio(rateioLines, amountCents).ok;
  }, [perProvider, providerLines, useRateio, rateioLines, amountCents]);

  const filteredTypes = (typesQuery.data || []).filter(
    (t) =>
      !selectedType ||
      t.kind === (entityType === 'both' ? t.kind : selectedType?.kind) ||
      filtro === 'todas' ||
      (filtro === 'fixa' && t.kind === 'fixed') ||
      (filtro === 'variavel' && t.kind === 'variable')
  );

  useEffect(() => {
    if (!selectedType) return;
    if (selectedType.default_entity) setEntityType(selectedType.default_entity);
    if (selectedType.default_cost_center_id) setCostCenterId(selectedType.default_cost_center_id);
    if (selectedType.kind === 'fixed' && selectedType.recurrence) setRecurrence(selectedType.recurrence);
  }, [selectedType]);

  useEffect(() => {
    if (useRateio && !rateioLines.length && amountCents > 0) {
      const ids = (ccQuery.data || []).map((c) => c.id);
      if (ids.length) setRateioLines(divideEqual(amountCents, ids));
    }
  }, [useRateio, amountCents, ccQuery.data, rateioLines.length]);

  const saveMut = useMutation({
    mutationFn: () =>
      saveBillingExpense({
        description,
        amount_cents: amountCents,
        expense_date: expenseDate,
        expense_type_id: expenseTypeId || null,
        legal_entity_type: entityType,
        recurrence: recurrence || null,
        cost_center_id: useRateio || perProvider ? null : costCenterId || selectedType?.default_cost_center_id || null,
        allocation: perProvider ? providerAllocationToRecord(providerLines) : useRateio ? rateioToAllocation(rateioLines) : {},
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['billing', 'expenses'] });
      await qc.invalidateQueries({ queryKey: ['billing', 'payables'] });
      setOpen(false);
      resetForm();
    },
  });

  const resetForm = () => {
    setDescription('');
    setAmount('');
    setUseRateio(false);
    setRateioLines([]);
    setProviderLines([]);
    setRecurrence('');
    setExpenseTypeId('');
    setCostCenterId('');
  };

  const lista = (expensesQuery.data || []).filter((e) => {
    const kind = e.billing_expense_types?.kind;
    if (filtro === 'todas') return true;
    if (filtro === 'fixa') return kind === 'fixed';
    return kind === 'variable';
  });
  const pagination = useClientPagination(lista);

  useEffect(() => {
    pagination.resetPage();
  }, [filtro]);

  return (
    <BillingSection
      title="Despesas"
      desc="Lançamentos fixos e variáveis com entidade, centro de custo e rateio."
      icon={Coins}
      action={
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Nova despesa
        </Button>
      }
    >
      <div className="flex items-center justify-between">
        <div className={billingSegmentShellClassName}>
          {(['todas', 'fixa', 'variavel'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFiltro(f)} className={billingSegmentButton(filtro === f)}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className={billingTableShellClassName}>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
            <tr>
              <th className="px-4 py-3">Descrição</th>
              <th className="px-4 py-3">Empresa</th>
              <th className="px-4 py-3">Classif.</th>
              <th className="px-4 py-3">Categoria</th>
              <th className="px-4 py-3">Rateio</th>
              <th className="px-4 py-3">Vencimento</th>
              <th className="px-4 py-3 text-right">Valor</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageItems.map((e) => {
              const allocKeys = Object.keys(e.allocation || {});
              const costCenterName = e.billing_cost_centers?.name;
              return (
                <tr key={e.id} className="border-b border-border/40 last:border-0">
                  <td className="px-4 py-3 font-medium">{e.description}</td>
                  <td className="px-4 py-3">
                    <BillingEntityBadge entity={e.legal_entity_type} />
                  </td>
                  <td className="px-4 py-3 text-xs capitalize">
                    {e.billing_expense_types?.kind === 'fixed' ? 'fixa' : 'variável'}
                  </td>
                  <td className="px-4 py-3 text-xs">{e.billing_expense_types?.name || '—'}</td>
                  <td className="px-4 py-3 text-[11px] text-muted-foreground">
                    {allocKeys.length ? `${allocKeys.length} CCs` : costCenterName || '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px]">{fmtDate(e.expense_date)}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">{formatBrlCents(e.amount_cents)}</td>
                </tr>
              );
            })}
            {!lista.length && !expensesQuery.isLoading ? (
              <tr>
                <td colSpan={7} className="p-4">
                  <BillingEmptyState>Nenhuma despesa.</BillingEmptyState>
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
            itemLabel="despesas"
          />
        ) : null}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <BillingDialogContent
          title="Nova despesa"
          description="Classifique a despesa, defina vencimento e escolha como ela será alocada no DRE."
          className="sm:max-w-2xl"
          footer={
            <>
              <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button className="flex-1 shadow-md" onClick={() => saveMut.mutate()} disabled={!description || !amount || !rateioValid || saveMut.isPending}>
                Lançar
              </Button>
            </>
          }
        >
          <div className="grid max-h-[70vh] grid-cols-2 gap-3 overflow-y-auto pr-1">
            <BillingField label="Descrição" className="col-span-2">
              <FormControl className="mt-1 w-full text-xs" value={description} onChange={(ev) => setDescription(ev.target.value)} />
            </BillingField>
            <BillingField label="Empresa">
              <FormSelect
                className="mt-1 w-full"
                value={entityType}
                onChange={(value) => setEntityType(value as typeof entityType)}
                options={[
                  { value: 'coop', label: 'Cooperativa' },
                  { value: 'flux', label: 'Flux Farma' },
                  { value: 'both', label: 'Ambas (a definir)' },
                ]}
              />
            </BillingField>
            <BillingField label="Classificação">
              <FormSelect
                className="mt-1 w-full"
                value={selectedType?.kind || 'variable'}
                onChange={(value) => {
                  const kind = value;
                  const match = (typesQuery.data || []).find((t) => t.kind === kind);
                  if (match) setExpenseTypeId(match.id);
                }}
                options={[
                  { value: 'fixed', label: 'Fixa' },
                  { value: 'variable', label: 'Variável' },
                ]}
              />
            </BillingField>
            <BillingField label="Categoria">
              <FormSelect
                className="mt-1 w-full"
                value={expenseTypeId}
                onChange={setExpenseTypeId}
                options={[
                  { value: '', label: '—' },
                  ...filteredTypes.map((t) => ({ value: t.id, label: t.name })),
                ]}
              />
            </BillingField>
            <BillingField label="Recorrência">
              <FormSelect
                className="mt-1 w-full"
                value={recurrence || 'unica'}
                onChange={(value) => setRecurrence(value === 'unica' ? '' : value)}
                options={[
                  { value: 'unica', label: 'Única' },
                  { value: 'weekly', label: 'Semanal' },
                  { value: 'monthly', label: 'Mensal' },
                  { value: 'yearly', label: 'Anual' },
                ]}
              />
            </BillingField>
            <BillingField label="Centro de custo" className="col-span-2">
              <FormSelect
                className="mt-1 w-full"
                value={costCenterId}
                disabled={useRateio || perProvider}
                onChange={setCostCenterId}
                options={[
                  { value: '', label: selectedType?.default_cost_center_id ? 'Padrão da categoria' : 'Sem centro de custo' },
                  ...(ccQuery.data || []).map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Informe onde a despesa entra no DRE. A empresa acima define quem paga.
              </p>
            </BillingField>
            <BillingField label="Valor (R$)">
              <FormControl className="mt-1 w-full text-xs" value={amount} onChange={(ev) => setAmount(ev.target.value)} />
            </BillingField>
            <BillingField label="Vencimento">
              <FormControl
                type="date"
                className="mt-1 w-full text-xs"
                value={expenseDate}
                onChange={(ev) => setExpenseDate(ev.target.value)}
              />
            </BillingField>
            <div className="col-span-2">
              <BillingSwitchRow
                checked={useRateio}
                disabled={perProvider}
                onChange={setUseRateio}
                label="Ratear esta despesa entre centros de custo"
              />
            </div>
            {perProvider && amountCents > 0 ? (
              <div className="col-span-2">
                <BillingProviderAllocationEditor
                  totalCents={amountCents}
                  providers={providersQuery.data || []}
                  value={providerLines}
                  onChange={setProviderLines}
                />
              </div>
            ) : null}
            {useRateio && amountCents > 0 && !perProvider ? (
              <div className="col-span-2">
                <BillingRateioEditor
                  totalCents={amountCents}
                  costCenters={ccQuery.data || []}
                  value={rateioLines}
                  onChange={setRateioLines}
                />
              </div>
            ) : null}
          </div>
        </BillingDialogContent>
      </Dialog>
    </BillingSection>
  );
}
