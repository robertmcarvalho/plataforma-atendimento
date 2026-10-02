'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormControl } from '@/components/form/FormControl';
import { BillingEmptyState, BillingField, BillingSection } from '@/components/billing/BillingPrimitives';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { billingSegmentButton, billingSegmentShellClassName, billingTableShellClassName } from '@/lib/billing/billingReviveUi';
import { useClientPagination } from '@/lib/billing/billingListUtils';
import { cn } from '@/lib/utils';
import {
  downloadInsuranceActiveCsv,
  downloadInsuranceTerminatedCsv,
  fetchInsuranceActiveReport,
  fetchInsuranceTerminatedReport,
  markBillingReportSent,
} from '@/lib/billing/billingApi';

function defaultMonth() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

export function BillingInsuranceReportPanel() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'active' | 'terminated'>('active');
  const [month, setMonth] = useState(defaultMonth());

  const activeQuery = useQuery({
    queryKey: ['billing', 'report', 'insurance-active', month],
    queryFn: () => fetchInsuranceActiveReport(month),
    enabled: tab === 'active' && !!month,
  });

  const terminatedQuery = useQuery({
    queryKey: ['billing', 'report', 'insurance-terminated', month],
    queryFn: () => fetchInsuranceTerminatedReport(month),
    enabled: tab === 'terminated' && !!month,
  });

  const rows = tab === 'active' ? activeQuery.data?.rows || [] : terminatedQuery.data?.rows || [];
  const pagination = useClientPagination(rows);

  useEffect(() => {
    pagination.resetPage();
  }, [tab, month]);

  const markMut = useMutation({
    mutationFn: () =>
      markBillingReportSent(tab === 'active' ? 'insurance-active' : 'insurance-terminated', {
        month,
        row_count: rows.length,
        cutoff_date: activeQuery.data?.cutoff_date ?? null,
      }),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ['billing', 'report', tab === 'active' ? 'insurance-active' : 'insurance-terminated', month],
      }),
  });

  const download = async () => {
    const csv =
      tab === 'active'
        ? await downloadInsuranceActiveCsv(month, activeQuery.data?.cutoff_date)
        : await downloadInsuranceTerminatedCsv(month);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `planilha-movimentacao-cooperativa-${tab === 'active' ? 'ativos' : 'desligados'}-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className={billingSegmentShellClassName}>
        {(['active', 'terminated'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={billingSegmentButton(tab === t)}
          >
            {t === 'active' ? 'Ativos' : 'Desligados no mês'}
          </button>
        ))}
      </div>

      <BillingSection title="Filtros e exportação" desc="Selecione competência, gere o modelo e marque envio quando concluir.">
        <div className="flex flex-wrap items-end gap-3">
          <BillingField label="Competência">
            <FormControl
              type="month"
              inputSize="sm"
              className="mt-1 w-36"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </BillingField>
          {tab === 'active' && activeQuery.data?.cutoff_date ? (
            <p className="text-xs text-muted-foreground">Corte: {activeQuery.data.cutoff_date}</p>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => void download()} disabled={!rows.length}>
            <Download className="mr-1 h-3.5 w-3.5" /> Exportar modelo seguradora
          </Button>
          <Button size="sm" onClick={() => markMut.mutate()} disabled={!rows.length || markMut.isPending}>
            <Send className="mr-1 h-3.5 w-3.5" /> Marcar enviado
          </Button>
        </div>
      </BillingSection>

      <p className="text-sm text-muted-foreground">{rows.length} registro(s)</p>

      <div className={cn(billingTableShellClassName, 'overflow-x-auto')}>
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">CPF</th>
              <th className="px-4 py-3">Nascimento</th>
              <th className="px-4 py-3">Telefone</th>
              <th className="px-4 py-3">Vínculo</th>
              <th className="px-4 py-3">Líder</th>
              <th className="px-4 py-3">Farmácias</th>
              {tab === 'terminated' ? (
                <>
                  <th className="px-4 py-3">Desligamento</th>
                  <th className="px-4 py-3">Motivo</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {pagination.pageItems.map((r) => (
              <tr key={r.driver_id} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2.5">{r.name}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.cpf || '—'}</td>
                <td className="px-4 py-2.5 text-xs">{r.birth_date || '—'}</td>
                <td className="px-4 py-2.5 text-xs">{r.phone || '—'}</td>
                <td className="px-4 py-2.5 text-xs">{r.contract_started_at || '—'}</td>
                <td className="px-4 py-2.5 text-xs">{r.leader_name || '—'}</td>
                <td className="px-4 py-2.5 text-xs">{r.pharmacies || '—'}</td>
                {tab === 'terminated' ? (
                  <>
                    <td className="px-4 py-2.5 text-xs">{r.inactive_at || '—'}</td>
                    <td className="px-4 py-2.5 text-xs">{r.termination_reason || '—'}</td>
                  </>
                ) : null}
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={tab === 'terminated' ? 9 : 7} className="p-4">
                  <BillingEmptyState>Nenhum registro para a competência selecionada.</BillingEmptyState>
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
            itemLabel="registros"
          />
        ) : null}
      </div>
    </div>
  );
}
