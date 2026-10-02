'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormControl } from '@/components/form/FormControl';
import { BillingEmptyState, BillingField, BillingSection } from '@/components/billing/BillingPrimitives';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { billingTableShellClassName } from '@/lib/billing/billingReviveUi';
import { useClientPagination } from '@/lib/billing/billingListUtils';
import {
  accrueCommissions,
  downloadCommissionsCsv,
  fetchCommissionsReport,
  generateCommissionPayables,
} from '@/lib/billing/billingApi';
import { formatBrlCents } from '@/lib/billing/billingFormat';
import { billingStatusLabel } from '@/lib/billing/billingLabels';

function defaultMonth() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

const ROLE_LABELS: Record<string, string> = {
  sales_agent: 'Venda',
  referrer: 'Indicação',
};

export function BillingCommissionsPanel() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(defaultMonth());
  const reportQuery = useQuery({
    queryKey: ['billing', 'report', 'commissions', month],
    queryFn: () => fetchCommissionsReport(month),
    enabled: !!month,
  });

  const accrueMut = useMutation({
    mutationFn: () => accrueCommissions(month),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['billing', 'report', 'commissions', month] });
      alert(`Provisões: ${res.created} criada(s), ${res.skipped} ignorada(s).`);
    },
  });

  const payablesMut = useMutation({
    mutationFn: () => generateCommissionPayables(month),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['billing', 'payables'] });
      alert(`AP: ${res.payables} título(s), ${res.accruals_linked} provisão(ões) vinculada(s).`);
    },
  });

  const download = async () => {
    const csv = await downloadCommissionsCsv(month);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comissoes-parceiros-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const rows = reportQuery.data?.rows || [];
  const pagination = useClientPagination(rows);

  useEffect(() => {
    pagination.resetPage();
  }, [month]);

  return (
    <div className="space-y-4">
      <BillingSection title="Filtros e ações" desc="Provisões por conversão de lead com parceiro vinculado. Comissão de líderes Flux fica em relatório dedicado.">
        <div className="flex flex-wrap items-end gap-3">
          <BillingField label="Competência">
            <FormControl type="month" inputSize="sm" className="mt-1 w-36" value={month} onChange={(e) => setMonth(e.target.value)} />
          </BillingField>
          <Button size="sm" variant="outline" onClick={() => accrueMut.mutate()} disabled={accrueMut.isPending}>
            Apurar provisões
          </Button>
          <Button size="sm" variant="outline" onClick={() => payablesMut.mutate()} disabled={payablesMut.isPending}>
            Gerar AP consolidado
          </Button>
          <Button size="sm" variant="outline" onClick={() => void download()} disabled={!rows.length}>
            <Download className="mr-1 h-3.5 w-3.5" /> Exportar CSV
          </Button>
        </div>
      </BillingSection>
      {reportQuery.data ? (
        <p className="text-xs text-muted-foreground">
          Total: <strong>{formatBrlCents(reportQuery.data.total_cents)}</strong> — {rows.length} linha(s)
        </p>
      ) : null}
      <div className={billingTableShellClassName}>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
            <tr>
              <th className="px-4 py-3">Parceiro</th>
              <th className="px-4 py-3">Papel</th>
              <th className="px-4 py-3">Lead</th>
              <th className="px-4 py-3 text-right">Negócio</th>
              <th className="px-4 py-3 text-right">Comissão</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageItems.map((r) => (
              <tr key={r.accrual_id} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2.5">{r.partner_name}</td>
                <td className="px-4 py-2.5 text-xs">{ROLE_LABELS[r.commission_role] || r.commission_role}</td>
                <td className="px-4 py-2.5">{r.lead_trade_name}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">
                  {r.deal_value_cents != null ? formatBrlCents(r.deal_value_cents) : '—'}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{formatBrlCents(r.amount_cents)}</td>
                <td className="px-4 py-2.5 text-xs">{r.payable_id ? 'AP gerado' : billingStatusLabel(r.status)}</td>
              </tr>
            ))}
            {!rows.length && !reportQuery.isLoading ? (
              <tr>
                <td colSpan={6} className="p-4">
                  <BillingEmptyState>Nenhuma provisão nesta competência. Apure após conversões do mês.</BillingEmptyState>
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
            itemLabel="provisões"
          />
        ) : null}
      </div>
    </div>
  );
}
