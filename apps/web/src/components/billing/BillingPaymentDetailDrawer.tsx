'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/button';
import { BillingAuditStamp } from '@/components/billing/BillingAuditStamp';
import type { BillingBankMovement, BillingPaymentRow } from '@/lib/billing/billingApi';
import { formatBrlCents, fmtDate } from '@/lib/billing/billingFormat';
import { cn } from '@/lib/utils';

function StatusChip({ reconciled }: { reconciled?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium',
        reconciled
          ? 'border-success/40 bg-success/10 text-success'
          : 'border-warning/40 bg-warning/10 text-warning'
      )}
    >
      {reconciled ? 'Conciliada' : 'Pendente'}
    </span>
  );
}

export function BillingPaymentDetailDrawer({
  payment,
  movement,
  targetLabel,
  open,
  onClose,
  onGoToMovement,
}: {
  payment: BillingPaymentRow | null;
  movement: BillingBankMovement | null;
  targetLabel: { type: string; detail: string };
  open: boolean;
  onClose: () => void;
  onGoToMovement?: (movementId: string) => void;
}) {
  if (!payment) {
    return (
      <Drawer open={open} onClose={onClose} title="Detalhe da baixa">
        <p className="text-sm text-muted-foreground">Selecione uma baixa para ver o histórico.</p>
      </Drawer>
    );
  }

  // `focus=1` / `include_paid=1` garantem que o título apareça mesmo com os filtros padrão da lista.
  const titleHref = payment.payable_id
    ? `/billing/pagar?payable_id=${payment.payable_id}&focus=1`
    : payment.invoice_id
      ? `/billing/receber?invoice_id=${payment.invoice_id}&include_paid=1`
      : null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`${formatBrlCents(payment.amount_cents)} · ${targetLabel.type}`}
      subtitle={targetLabel.detail}
      eyebrow="Detalhe da baixa"
      footer={
        <div className="flex flex-wrap gap-2">
          {titleHref ? (
            <Link
              href={titleHref}
              className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted"
            >
              Abrir título <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          ) : null}
          {movement ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                onGoToMovement?.(movement.id);
                onClose();
              }}
            >
              Ir ao movimento
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={onClose}>
            Fechar
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip reconciled={payment.reconciled} />
          <span className="text-xs text-muted-foreground">{payment.payment_method || 'Sem método'}</span>
        </div>

        <ol className="space-y-3 border-l border-border pl-4">
          <li className="relative">
            <span className="absolute -left-[1.15rem] top-1 h-2.5 w-2.5 rounded-full bg-primary" />
            <div className="font-medium">Baixa registrada</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {fmtDate(payment.paid_at)} · {formatBrlCents(payment.amount_cents)}
            </div>
            <div className="mt-1">
              <BillingAuditStamp prefix="Baixa por" actorName={payment.created_by_user?.name} at={payment.paid_at} />
            </div>
            {payment.notes ? <div className="mt-1 text-xs text-muted-foreground">Obs.: {payment.notes}</div> : null}
          </li>

          <li className="relative">
            <span
              className={cn(
                'absolute -left-[1.15rem] top-1 h-2.5 w-2.5 rounded-full',
                payment.reconciled ? 'bg-success' : 'bg-muted-foreground/40'
              )}
            />
            <div className="font-medium">Conciliação</div>
            {payment.reconciled && payment.reconciled_at ? (
              <div className="mt-1">
                <BillingAuditStamp
                  prefix="Conciliado por"
                  actorName={payment.reconciled_by_user?.name}
                  at={payment.reconciled_at}
                />
              </div>
            ) : (
              <div className="mt-0.5 text-xs text-warning">Ainda sem vínculo com o extrato bancário.</div>
            )}
          </li>

          <li className="relative">
            <span
              className={cn(
                'absolute -left-[1.15rem] top-1 h-2.5 w-2.5 rounded-full',
                movement ? 'bg-success' : 'bg-muted-foreground/40'
              )}
            />
            <div className="font-medium">Movimento bancário</div>
            {movement ? (
              <div className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
                <div>
                  {fmtDate(movement.movement_date)} · {movement.direction === 'debit' ? 'Saída' : 'Entrada'} ·{' '}
                  {formatBrlCents(movement.amount_cents)}
                </div>
                <div className="leading-snug">{movement.description || 'Sem descrição'}</div>
              </div>
            ) : (
              <div className="mt-0.5 text-xs text-muted-foreground">Nenhum movimento vinculado ainda.</div>
            )}
          </li>
        </ol>
      </div>
    </Drawer>
  );
}
