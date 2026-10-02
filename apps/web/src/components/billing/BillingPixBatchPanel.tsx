'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormSelect } from '@/components/form/FormSelect';
import { FormControl } from '@/components/form/FormControl';
import { BillingEmptyState, BillingField, BillingSection } from '@/components/billing/BillingPrimitives';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { billingTableShellClassName } from '@/lib/billing/billingReviveUi';
import { useClientPagination } from '@/lib/billing/billingListUtils';
import {
  downloadPixBatchExport,
  exportPayablesBatch,
  fetchBankAccounts,
  fetchCostCenters,
  fetchPayablesBatchPreview,
} from '@/lib/billing/billingApi';
import { formatBrlCents } from '@/lib/billing/billingFormat';

export function BillingPixBatchPanel() {
  const [paymentDate, setPaymentDate] = useState('');
  const [legalEntityType, setLegalEntityType] = useState<'coop' | 'flux' | ''>('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [beneficiaryType, setBeneficiaryType] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [selectedPayableIds, setSelectedPayableIds] = useState<string[]>([]);

  const accountsQuery = useQuery({ queryKey: ['billing', 'bank-accounts'], queryFn: () => fetchBankAccounts({ active: true }) });
  const costCentersQuery = useQuery({ queryKey: ['billing', 'cost-centers', 'active'], queryFn: () => fetchCostCenters(true) });
  const previewParams = useMemo(
    () => ({
      payment_date: paymentDate || undefined,
      legal_entity_type: legalEntityType,
      bank_account_id: bankAccountId || undefined,
      beneficiary_type: beneficiaryType || undefined,
      cost_center_id: costCenterId || undefined,
    }),
    [bankAccountId, beneficiaryType, costCenterId, legalEntityType, paymentDate]
  );
  const previewQuery = useQuery({
    queryKey: ['billing', 'payables-batch-preview', previewParams],
    queryFn: () => fetchPayablesBatchPreview(previewParams),
  });

  const exportMut = useMutation({
    mutationFn: () =>
      exportPayablesBatch({
        ...previewParams,
        payable_ids: selectedPayableIds.length ? selectedPayableIds : undefined,
      }),
    onSuccess: (data) => {
      downloadPixBatchExport(data);
      setSelectedPayableIds([]);
      void previewQuery.refetch();
    },
  });

  const rows = previewQuery.data?.rows || [];
  const pagination = useClientPagination(rows);
  const batches = previewQuery.data?.batches || [];
  const exportableRows = rows.filter((row) => row.payable_id && !row.warnings.length);
  const allSelected = exportableRows.length > 0 && exportableRows.every((row) => selectedPayableIds.includes(row.payable_id!));
  const selectedTotalCents = exportableRows
    .filter((row) => selectedPayableIds.includes(row.payable_id!))
    .reduce((sum, row) => sum + row.amount_cents, 0);

  useEffect(() => {
    pagination.resetPage();
    setSelectedPayableIds([]);
  }, [paymentDate, legalEntityType, bankAccountId, beneficiaryType, costCenterId]);

  const togglePayable = (id: string, checked: boolean) => {
    setSelectedPayableIds((current) => (checked ? [...new Set([...current, id])] : current.filter((rowId) => rowId !== id)));
  };

  return (
    <div className="space-y-4">
      <BillingSection title="Pagamentos em lote" desc="APs PIX do acerto e demais títulos (diárias ficam em PIX — Diárias). Filtre e selecione o que entra no Excel C6.">
        <div className="flex flex-wrap gap-4">
          <BillingField label="Data programada" className="min-w-[180px]">
            <FormControl type="date" className="mt-1 w-full" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </BillingField>
          <BillingField label="Entidade pagadora" className="min-w-[180px]">
            <FormSelect
              className="mt-1 w-full"
              value={legalEntityType}
              onChange={(value) => setLegalEntityType(value as 'coop' | 'flux' | '')}
              options={[
                { value: '', label: 'Todas' },
                { value: 'coop', label: 'Cooperativa' },
                { value: 'flux', label: 'Flux' },
              ]}
            />
          </BillingField>
          <BillingField label="Conta / template PIX" className="min-w-[220px]">
            <FormSelect
              className="mt-1 w-full"
              value={bankAccountId}
              onChange={setBankAccountId}
              options={[
                { value: '', label: 'Qualquer conta' },
                ...(accountsQuery.data || [])
                  .filter((a) => a.id)
                  .map((a) => ({
                    value: a.id as string,
                    label: `${a.name} (${a.pix_export_template})`,
                  })),
              ]}
            />
          </BillingField>
          <BillingField label="Beneficiário" className="min-w-[200px]">
            <FormSelect
              className="mt-1 w-full"
              value={beneficiaryType}
              onChange={setBeneficiaryType}
              options={[
                { value: '', label: 'Todos' },
                { value: 'driver', label: 'Entregadores' },
                { value: 'leader', label: 'Líderes' },
                { value: 'commercial_partner', label: 'Parceiros' },
                { value: 'internal_provider', label: 'Prestadores internos' },
                { value: 'shareholder', label: 'Sócios/cooperados' },
                { value: 'supplier', label: 'Fornecedores' },
                { value: 'operational', label: 'Operacional/despesas' },
              ]}
            />
          </BillingField>
          <BillingField label="Centro de custo" className="min-w-[240px]">
            <FormSelect
              className="mt-1 w-full"
              value={costCenterId}
              onChange={setCostCenterId}
              options={[
                { value: '', label: 'Todos' },
                ...(costCentersQuery.data || []).map((cc) => ({ value: cc.id, label: cc.name })),
              ]}
            />
          </BillingField>
        </div>
      </BillingSection>

      {previewQuery.data ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Total exportável filtrado: <strong>{formatBrlCents(previewQuery.data.total_cents)}</strong> — {rows.length} título(s). Selecionado:{' '}
            <strong>{formatBrlCents(selectedPayableIds.length ? selectedTotalCents : previewQuery.data.total_cents)}</strong>
          </p>
          {batches.length ? (
            <div className="flex flex-wrap gap-2">
              {batches.map((batch) => (
                <span
                  key={batch.payment_date}
                  className="rounded-full border border-border bg-surface px-3 py-1 text-[11px] text-muted-foreground"
                >
                  {batch.payment_date}: {batch.rows.length - batch.blocked_count} pagamento(s),{' '}
                  {formatBrlCents(batch.total_cents)}
                  {batch.blocked_count ? ` (${batch.blocked_count} bloqueado(s))` : ''}
                  {batch.original_payment_dates.length && batch.original_payment_dates.some((d) => d !== batch.payment_date)
                    ? ` · original ${batch.original_payment_dates.join(', ')}`
                    : ''}
                  {batch.adjustment_reasons.length ? ` · ajuste ${batch.adjustment_reasons.join(', ')}` : ''}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <Button size="sm" onClick={() => exportMut.mutate()} disabled={exportMut.isPending || !exportableRows.length}>
        <Download className="mr-1 h-3.5 w-3.5" /> Exportar lote C6
      </Button>

      <div className={billingTableShellClassName}>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
            <tr>
              <th className="px-4 py-3">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(checked) =>
                    setSelectedPayableIds(checked ? exportableRows.map((row) => row.payable_id!).filter(Boolean) : [])
                  }
                  aria-label="Selecionar todos"
                />
              </th>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">CPF</th>
              <th className="px-4 py-3">PIX</th>
              <th className="px-4 py-3">Data efetiva</th>
              <th className="px-4 py-3">Data original</th>
              <th className="px-4 py-3">Valor</th>
              <th className="px-4 py-3">Alertas</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageItems.map((r, i) => (
              <tr key={r.payable_id || i} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2.5">
                  {r.payable_id && !r.warnings.length ? (
                    <Checkbox
                      checked={selectedPayableIds.includes(r.payable_id)}
                      onCheckedChange={(checked) => togglePayable(r.payable_id!, Boolean(checked))}
                      aria-label={`Selecionar ${r.name}`}
                    />
                  ) : null}
                </td>
                <td className="px-4 py-2.5">{r.name}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.beneficiary_type || '—'}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.cpf || '—'}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.pix_key || '—'}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.payment_date || '—'}</td>
                <td className="px-4 py-2.5 text-xs">
                  <span className="font-mono">{r.original_payment_date || r.payment_date || '—'}</span>
                  {r.payment_adjustment_reason ? (
                    <span className="ml-1 text-amber-600">({r.payment_adjustment_reason})</span>
                  ) : null}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs">{formatBrlCents(r.amount_cents)}</td>
                <td className="px-4 py-2.5 text-xs text-warning">{r.warnings.join(', ')}</td>
              </tr>
            ))}
            {!rows.length && !previewQuery.isLoading ? (
              <tr>
                <td colSpan={9} className="p-4">
                  <BillingEmptyState>Sem AP PIX aprovado e elegível para os filtros selecionados.</BillingEmptyState>
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
    </div>
  );
}
