'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormControl } from '@/components/form/FormControl';
import { BillingEmptyState, BillingField, BillingSection } from '@/components/billing/BillingPrimitives';
import { billingTableShellClassName } from '@/lib/billing/billingReviveUi';
import { useClientPagination } from '@/lib/billing/billingListUtils';
import { PaginationControls } from '@/components/ui/PaginationControls';
import {
  downloadInssAccountingCsv,
  fetchInssAccountingReport,
  markBillingReportSent,
} from '@/lib/billing/billingApi';
import { formatBrlCents } from '@/lib/billing/billingFormat';
import { BillingBackLink } from '@/components/billing/BillingBackLink';

function defaultMonth() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

export function BillingInssReportPanel() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(defaultMonth());

  const reportQuery = useQuery({
    queryKey: ['billing', 'report', 'inss', month],
    queryFn: () => fetchInssAccountingReport(month),
    enabled: !!month,
  });

  const markMut = useMutation({
    mutationFn: () =>
      markBillingReportSent('inss-accounting', {
        month,
        row_count: reportQuery.data?.rows.length || 0,
        total_cents: reportQuery.data?.total_cents ?? null,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing', 'report', 'inss', month] }),
  });

  const download = async () => {
    const csv = await downloadInssAccountingCsv(month);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inss-contabilidade-${month}.csv`;
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
      <BillingBackLink href="/billing/relatorios" label="Voltar para relatórios" />
      <BillingSection title="Filtros e exportação" desc="Selecione a competência e gere o arquivo para contabilidade.">
        <div className="flex flex-wrap items-end gap-3">
          <BillingField label="Competência (mês civil)">
            <FormControl
              type="month"
              inputSize="sm"
              className="mt-1 w-36"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </BillingField>
          <Button size="sm" variant="outline" onClick={() => void download()} disabled={!rows.length}>
            <Download className="mr-1 h-3.5 w-3.5" /> Exportar CSV
          </Button>
          <Button size="sm" onClick={() => markMut.mutate()} disabled={!rows.length || markMut.isPending}>
            <Send className="mr-1 h-3.5 w-3.5" /> Marcar enviado
          </Button>
        </div>
      </BillingSection>

      {reportQuery.data?.sent_at ? (
        <p className="text-xs text-success">Enviado em {new Date(reportQuery.data.sent_at).toLocaleString('pt-BR')}</p>
      ) : null}

      {reportQuery.data ? (
        <p className="text-xs text-muted-foreground">
          Total: <strong>{formatBrlCents(reportQuery.data.total_cents)}</strong> — {rows.length} cooperado(s)
        </p>
      ) : null}

      <div className={billingTableShellClassName}>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">CPF</th>
              <th className="px-4 py-3 text-right">Remuneração bruta</th>
            </tr>
          </thead>
          <tbody>
            {pagination.pageItems.map((r) => (
              <tr key={r.driver_id} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2.5">{r.name}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.cpf || '—'}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">
                  {formatBrlCents(r.gross_remuneration_cents)}
                </td>
              </tr>
            ))}
            {!rows.length && !reportQuery.isLoading ? (
              <tr>
                <td colSpan={3} className="p-4">
                  <BillingEmptyState>Nenhum cooperado nesta competência.</BillingEmptyState>
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
            itemLabel="cooperados"
          />
        ) : null}
      </div>
    </div>
  );
}
