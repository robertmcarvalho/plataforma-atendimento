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
  accrueLeaderCommissions,
  downloadLeaderCommissionsCsv,
  fetchLeaderCommissionsReport,
  generateLeaderCommissionPayables,
} from '@/lib/billing/billingApi';
import { formatBrlCents } from '@/lib/billing/billingFormat';
import { billingStatusLabel } from '@/lib/billing/billingLabels';

function defaultMonth() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

export function BillingLeaderCommissionsPanel() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(defaultMonth());
  const reportQuery = useQuery({
    queryKey: ['billing', 'report', 'leader-commissions', month],
    queryFn: () => fetchLeaderCommissionsReport(month),
    enabled: !!month,
  });

  const accrueMut = useMutation({
    mutationFn: () => accrueLeaderCommissions(month),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['billing', 'report', 'leader-commissions', month] });
      alert(`Provisões líder: ${res.created} criada(s), ${res.skipped} ignorada(s).`);
    },
  });

  const payablesMut = useMutation({
    mutationFn: () => generateLeaderCommissionPayables(month),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['billing', 'payables'] });
      alert(`AP líderes: ${res.payables} título(s), ${res.accruals_linked} provisão(ões).`);
    },
  });

  const download = async () => {
    const csv = await downloadLeaderCommissionsCsv(month);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comissoes-lideres-flux-${month}.csv`;
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
      <BillingSection title="Filtros e ações" desc="Margem Flux = faturamento Flux dos acertos do mês × margem de serviço. Comissão do líder = % configurado × margem.">
        <div className="flex flex-wrap items-end gap-3">
          <BillingField label="Competência">
            <FormControl type="month" inputSize="sm" className="mt-1 w-36" value={month} onChange={(e) => setMonth(e.target.value)} />
          </BillingField>
          <Button size="sm" variant="outline" onClick={() => accrueMut.mutate()} disabled={accrueMut.isPending}>
            Apurar provisões
          </Button>
          <Button size="sm" variant="outline" onClick={() => payablesMut.mutate()} disabled={payablesMut.isPending}>
            Gerar AP (venc. dia 15)
          </Button>
          <Button size="sm" variant="outline" onClick={() => void download()} disabled={!rows.length}>
            <Download className="mr-1 h-3.5 w-3.5" /> CSV
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
              <th className="px-4 py-3">Líder</th>
              <th className="px-4 py-3">Farmácia</th>
              <th className="px-4 py-3 text-right">Fat. Flux</th>
              <th className="px-4 py-3 text-right">Margem</th>
              <th className="px-4 py-3 text-right">Comissão</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageItems.map((r) => (
              <tr key={r.accrual_id} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2.5">{r.leader_name}</td>
                <td className="px-4 py-2.5">{r.pharmacy_name}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{formatBrlCents(r.flux_billing_cents)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{formatBrlCents(r.flux_margin_cents)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{formatBrlCents(r.amount_cents)}</td>
                <td className="px-4 py-2.5 text-xs">{r.payable_id ? 'AP gerado' : billingStatusLabel(r.status)}</td>
              </tr>
            ))}
            {!rows.length && !reportQuery.isLoading ? (
              <tr>
                <td colSpan={6} className="p-4">
                  <BillingEmptyState>Sem provisões. Configure % dos líderes e apure após acertos do mês.</BillingEmptyState>
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
