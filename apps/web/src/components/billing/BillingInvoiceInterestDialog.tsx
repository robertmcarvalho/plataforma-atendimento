'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { BillingDialogContent, BillingField } from '@/components/billing/BillingPrimitives';
import { FormControl } from '@/components/form/FormControl';
import { addInvoiceInterest, type BillingInvoiceDetail } from '@/lib/billing/billingApi';
import { formatBrlCents } from '@/lib/billing/billingFormat';

type Props = {
  invoice: BillingInvoiceDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultAmountCents?: number;
  sourceMovementId?: string | null;
  onSuccess?: () => void;
};

export function BillingInvoiceInterestDialog({
  invoice,
  open,
  onOpenChange,
  defaultAmountCents,
  sourceMovementId,
  onSuccess,
}: Props) {
  const qc = useQueryClient();
  const balance = invoice.total_cents - invoice.amount_paid_cents;
  const [amountCents, setAmountCents] = useState(defaultAmountCents ?? 0);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setAmountCents(defaultAmountCents ?? 0);
    setReason('');
  }, [open, defaultAmountCents]);

  const mut = useMutation({
    mutationFn: () =>
      addInvoiceInterest(invoice.id, {
        amount_cents: amountCents,
        reason: reason.trim(),
        source_movement_id: sourceMovementId || null,
      }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['billing', 'invoices'] }),
        qc.invalidateQueries({ queryKey: ['billing', 'invoice', invoice.id] }),
      ]);
      onOpenChange(false);
      onSuccess?.();
    },
  });

  const amountReais = (amountCents / 100).toFixed(2).replace('.', ',');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <BillingDialogContent
        title="Lançar juros / diferença de crédito"
        description="Aumenta o total da fatura (receita financeira). Não altera a conciliação bancária até registrar a baixa pelo valor do extrato."
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
              Cancelar
            </Button>
            <Button
              disabled={mut.isPending || amountCents <= 0 || reason.trim().length < 3}
              onClick={() => mut.mutate()}
            >
              Lançar juros
            </Button>
          </>
        }
      >
        <div className="rounded-lg border border-border bg-surface-elevated p-3 text-xs text-muted-foreground">
          Saldo atual da fatura: <strong className="text-foreground">{formatBrlCents(balance)}</strong>
          {' · '}
          Total após juros:{' '}
          <strong className="text-foreground">{formatBrlCents(invoice.total_cents + amountCents)}</strong>
        </div>
        <BillingField label="Valor dos juros (R$)">
          <FormControl
            className="mt-1"
            type="text"
            inputMode="decimal"
            value={amountReais}
            placeholder="0,00"
            onChange={(e) => {
              const raw = e.target.value.replace(/[^\d,]/g, '').replace(',', '.');
              const n = Number.parseFloat(raw);
              setAmountCents(Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0);
            }}
          />
        </BillingField>
        <BillingField label="Motivo (obrigatório)">
          <FormControl
            className="mt-1"
            value={reason}
            placeholder="Ex.: diferença de centavos no TED bancário"
            onChange={(e) => setReason(e.target.value)}
          />
        </BillingField>
      </BillingDialogContent>
    </Dialog>
  );
}
