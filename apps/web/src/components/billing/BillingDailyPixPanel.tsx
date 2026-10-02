'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { BillingEmptyState, BillingField, BillingSection } from '@/components/billing/BillingPrimitives';
import { billingTableShellClassName } from '@/lib/billing/billingReviveUi';
import { formatBrlCents } from '@/lib/billing/billingFormat';
import {
  downloadPixBatchExport,
  exportDailyPixBatch,
  fetchBankAccounts,
  fetchDailyPixPreview,
  syncDailyPixPayables,
} from '@/lib/billing/billingApi';

function nextTuesdayIso(from = new Date()): string {
  const d = new Date(from);
  const day = d.getDay(); // 0=Dom … 2=Ter
  const add = day === 2 ? 0 : (2 - day + 7) % 7;
  d.setDate(d.getDate() + add);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dayNum = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dayNum}`;
}

export function BillingDailyPixPanel({ initialPaymentDate }: { initialPaymentDate?: string }) {
  const [paymentDate, setPaymentDate] = useState(initialPaymentDate || nextTuesdayIso());
  const [bankAccountId, setBankAccountId] = useState('');

  const accountsQuery = useQuery({ queryKey: ['billing', 'bank-accounts'], queryFn: () => fetchBankAccounts({ active: true }) });
  const previewQuery = useQuery({
    queryKey: ['billing', 'pix-dailies-preview', paymentDate],
    queryFn: () => fetchDailyPixPreview(paymentDate),
    enabled: Boolean(paymentDate),
  });

  const exportMut = useMutation({
    mutationFn: () =>
      exportDailyPixBatch({
        payment_date: paymentDate,
        bank_account_id: bankAccountId || undefined,
        sync_payables: true,
      }),
    onSuccess: (data) => {
      downloadPixBatchExport(data);
      void previewQuery.refetch();
    },
  });

  const syncMut = useMutation({
    mutationFn: () => syncDailyPixPayables(paymentDate),
    onSuccess: () => void previewQuery.refetch(),
  });

  const rows = previewQuery.data?.rows || [];
  const exportable = useMemo(() => rows.filter((r) => !r.warnings.includes('PIX não cadastrado')), [rows]);

  return (
    <div className="space-y-4">
      <BillingSection
        title="PIX — Diárias"
        desc="Exporta C6 das diárias aprovadas no Financeiro com parcela na data (lote de terça). Trilha separada do acerto semanal (quinta)."
        icon={Wallet}
      >
        <div className="flex flex-wrap gap-4">
          <BillingField label="Data de pagamento" className="min-w-[180px]">
            <FormControl type="date" className="mt-1 w-full" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </BillingField>
          <BillingField label="Conta / template PIX" className="min-w-[220px]">
            <FormSelect
              className="mt-1 w-full"
              value={bankAccountId}
              onChange={setBankAccountId}
              options={[
                { value: '', label: 'Conta padrão / C6' },
                ...(accountsQuery.data || [])
                  .filter((a) => a.id)
                  .map((a) => ({
                    value: a.id as string,
                    label: `${a.name} (${a.pix_export_template})`,
                  })),
              ]}
            />
          </BillingField>
        </div>
      </BillingSection>

      {previewQuery.data ? (
        <p className="text-xs text-muted-foreground">
          Total exportável: <strong>{formatBrlCents(previewQuery.data.total_cents)}</strong> — {exportable.length} entregador(es).
          {previewQuery.data.skipped_no_pix ? (
            <span className="text-warning"> · {previewQuery.data.skipped_no_pix} sem PIX</span>
          ) : null}
          {previewQuery.data.pending_approval_count ? (
            <span className="text-warning">
              {' '}
              · {previewQuery.data.pending_approval_count} diária(s) ainda pendente(s) de aprovação no Financeiro
            </span>
          ) : null}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => exportMut.mutate()} disabled={exportMut.isPending || !exportable.length}>
          <Download className="mr-1 h-3.5 w-3.5" />
          {exportMut.isPending ? 'Exportando…' : 'Exportar C6 diárias'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => syncMut.mutate()} disabled={syncMut.isPending || !paymentDate}>
          {syncMut.isPending ? 'Sincronizando…' : 'Só gerar APs (sem export)'}
        </Button>
      </div>

      {exportMut.isError ? (
        <p className="text-sm text-destructive">{(exportMut.error as Error)?.message || 'Falha no export'}</p>
      ) : null}
      {syncMut.isSuccess ? (
        <p className="text-sm text-success">
          APs: {syncMut.data.created} criado(s), {syncMut.data.existing} já existia(m).
        </p>
      ) : null}

      <div className={billingTableShellClassName}>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">CPF</th>
              <th className="px-4 py-3">PIX</th>
              <th className="px-4 py-3">Valor</th>
              <th className="px-4 py-3">Alertas</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.reference || r.driver_id} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2.5 font-medium">{r.name}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.cpf || '—'}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.pix_key || '—'}</td>
                <td className="px-4 py-2.5 font-mono">{formatBrlCents(r.amount_cents)}</td>
                <td className="px-4 py-2.5 text-xs text-warning">{r.warnings.join('; ') || '—'}</td>
              </tr>
            ))}
            {!rows.length && !previewQuery.isLoading ? (
              <tr>
                <td colSpan={5} className="p-4">
                  <BillingEmptyState>
                    Nenhuma diária aprovada com parcela pendente nesta data. Aprove em /financial primeiro.
                  </BillingEmptyState>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
