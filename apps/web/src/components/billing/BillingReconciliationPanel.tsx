'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormSelect } from '@/components/form/FormSelect';
import { FormControl } from '@/components/form/FormControl';
import { BillingEmptyState, BillingField, BillingSection } from '@/components/billing/BillingPrimitives';
import { billingTableShellClassName } from '@/lib/billing/billingReviveUi';
import {
  fetchBankAccounts,
  fetchBankMovements,
  fetchTreasurySummary,
  fetchUnreconciledPayments,
  importBankMovements,
  reconcileBankMovement,
} from '@/lib/billing/billingApi';
import { formatBrlCents } from '@/lib/billing/billingFormat';

export function BillingReconciliationPanel() {
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState('');
  const [format, setFormat] = useState<'csv' | 'ofx'>('csv');
  const [fileContent, setFileContent] = useState('');
  const [linkPayment, setLinkPayment] = useState<Record<string, string>>({});

  const accountsQuery = useQuery({ queryKey: ['billing', 'bank-accounts'], queryFn: () => fetchBankAccounts({ active: true }) });
  const summaryQuery = useQuery({
    queryKey: ['billing', 'treasury-summary', accountId],
    queryFn: () => fetchTreasurySummary(accountId || undefined),
  });
  const movementsQuery = useQuery({
    queryKey: ['billing', 'bank-movements', accountId],
    queryFn: () => fetchBankMovements({ bank_account_id: accountId || undefined, reconciled: false }),
    enabled: !!accountId,
  });
  const paymentsQuery = useQuery({ queryKey: ['billing', 'payments-unreconciled'], queryFn: fetchUnreconciledPayments });

  const importMut = useMutation({
    mutationFn: () => importBankMovements(accountId, format, fileContent),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['billing', 'bank-movements'] });
      await qc.invalidateQueries({ queryKey: ['billing', 'treasury-summary'] });
      setFileContent('');
      alert(`Importados: ${res.imported}, ignorados: ${res.skipped}`);
    },
  });

  const reconcileMut = useMutation({
    mutationFn: ({ movementId, paymentId }: { movementId: string; paymentId: string }) =>
      reconcileBankMovement(movementId, paymentId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['billing', 'bank-movements'] });
      await qc.invalidateQueries({ queryKey: ['billing', 'payments-unreconciled'] });
      await qc.invalidateQueries({ queryKey: ['billing', 'treasury-summary'] });
    },
  });

  const onFile = async (file: File | null) => {
    if (!file) return;
    setFileContent(await file.text());
  };

  const accounts = accountsQuery.data || [];
  const movements = movementsQuery.data || [];
  const payments = paymentsQuery.data || [];

  return (
    <div className="space-y-6">
      {summaryQuery.data ? (
        <p className="text-sm text-muted-foreground">
          Pendentes: <strong>{summaryQuery.data.unreconciled_movements}</strong> movimento(s) bancário(s),{' '}
          <strong>{summaryQuery.data.unreconciled_payments}</strong> baixa(s) no sistema.
        </p>
      ) : null}

      <BillingSection title="Importar extrato (CSV ou OFX)" desc="CSV: colunas data, valor, descrição. OFX: transações STMTTRN padrão.">
        <div className="flex flex-wrap gap-3 items-end">
          <BillingField label="Conta">
            <FormSelect
              className="mt-1 min-w-[200px]"
              size="sm"
              value={accountId}
              onChange={setAccountId}
              options={[
                { value: '', label: 'Selecione…' },
                ...accounts.filter((a) => a.id).map((a) => ({ value: a.id as string, label: a.name })),
              ]}
            />
          </BillingField>
          <BillingField label="Formato">
            <FormSelect
              className="mt-1 w-28"
              size="sm"
              value={format}
              onChange={(value) => setFormat(value as 'csv' | 'ofx')}
              options={[
                { value: 'csv', label: 'CSV' },
                { value: 'ofx', label: 'OFX' },
              ]}
            />
          </BillingField>
          <BillingField label="Arquivo">
            <FormControl type="file" accept=".csv,.ofx,.txt" className="mt-1 block text-xs" onChange={(e) => void onFile(e.target.files?.[0] || null)} />
          </BillingField>
          <Button
            size="sm"
            onClick={() => importMut.mutate()}
            disabled={!accountId || !fileContent || importMut.isPending}
          >
            <Upload className="mr-1 h-3.5 w-3.5" /> Importar
          </Button>
        </div>
      </BillingSection>

      <div className={billingTableShellClassName}>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
            <tr>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Descrição</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3">Vincular baixa</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2.5 text-xs">{m.movement_date}</td>
                <td className="px-4 py-2.5">{m.description || '—'}</td>
                <td className="px-4 py-2.5 text-xs uppercase">{m.direction === 'credit' ? 'Crédito' : 'Débito'}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{formatBrlCents(m.amount_cents)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-1">
                    <FormSelect
                      className="min-w-44"
                      size="sm"
                      value={linkPayment[m.id] || ''}
                      onChange={(value) => setLinkPayment((s) => ({ ...s, [m.id]: value }))}
                      options={[
                        { value: '', label: 'Baixa…' },
                        ...payments.map((p) => ({
                          value: p.id,
                          label: `${formatBrlCents(p.amount_cents)} — ${p.paid_at.slice(0, 10)}`,
                        })),
                      ]}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!linkPayment[m.id] || reconcileMut.isPending}
                      onClick={() => reconcileMut.mutate({ movementId: m.id, paymentId: linkPayment[m.id] })}
                    >
                      OK
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!movements.length && accountId && !movementsQuery.isLoading ? (
              <tr>
                <td colSpan={5} className="p-4">
                  <BillingEmptyState>Nenhum movimento pendente para esta conta.</BillingEmptyState>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
