export type ReopenSettlementLike = { status: string; driver_id?: string };

export type ReopenInvoiceLike = { status: string; amount_paid_cents?: number | null };

export type ReopenPayableLike = {
  status: string;
  amount_paid_cents?: number | null;
  origin_type?: string | null;
  beneficiary_id?: string | null;
};

export function isReopenableSettlementStatus(status: string): boolean {
  return status === 'in_review' || status === 'approved';
}

export function isPaidFinancialLock(status: string, amountPaidCents?: number | null): boolean {
  return String(status) === 'paid' || Number(amountPaidCents || 0) > 0;
}

export function pharmacySettlementsReopenBlocker(settlements: ReopenSettlementLike[]): string | null {
  if (!settlements.length) return 'Acerto não encontrado para esta farmácia.';
  if (settlements.some((row) => String(row.status) === 'paid')) {
    return 'Não é possível estornar: há acerto marcado como pago.';
  }
  if (!settlements.some((row) => isReopenableSettlementStatus(String(row.status)))) {
    return 'Não há acerto aprovado ou em revisão para estornar. Os acertos já estão abertos.';
  }
  return null;
}

export function reopenInvoiceBlocker(invoices: ReopenInvoiceLike[]): string | null {
  if (invoices.some((row) => isPaidFinancialLock(String(row.status), row.amount_paid_cents))) {
    return 'Não é possível estornar: há fatura com pagamento registrado para esta farmácia.';
  }
  return null;
}

export function reopenPayableBlocker(payables: ReopenPayableLike[], driverIds?: string[]): string | null {
  const driverSet = driverIds?.length ? new Set(driverIds) : null;
  const locked = payables.some((row) => {
    if (row.origin_type && row.origin_type !== 'cycle_settlement') return false;
    if (driverSet && row.beneficiary_id && !driverSet.has(String(row.beneficiary_id))) return false;
    return isPaidFinancialLock(String(row.status), row.amount_paid_cents);
  });
  if (locked) {
    return driverSet
      ? 'Não é possível estornar: há título em A pagar com baixa para um entregador desta farmácia.'
      : 'Não é possível estornar: há título em A pagar com baixa para este entregador.';
  }
  return null;
}
