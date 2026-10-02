/** Client-side helpers for juros / diferença de crédito (mirrors api billingInvoiceInterest). */

export function invoiceAvailableCents(input: {
  totalCents: number;
  amountPaidCents: number;
  pendingUnreconciledCents?: number;
}): number {
  const pending = Math.max(0, Number(input.pendingUnreconciledCents || 0));
  return Number(input.totalCents) - Number(input.amountPaidCents) - pending;
}

export function interestCentsForCredit(input: {
  invoiceTotalCents: number;
  amountPaidCents: number;
  pendingUnreconciledCents?: number;
  creditCents: number;
}): number {
  const available = invoiceAvailableCents({
    totalCents: input.invoiceTotalCents,
    amountPaidCents: input.amountPaidCents,
    pendingUnreconciledCents: input.pendingUnreconciledCents,
  });
  const credit = Number(input.creditCents);
  if (credit <= available) return 0;
  return Math.round(credit - available);
}

export function isInterestLine(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  const m = metadata as Record<string, unknown>;
  return m.kind === 'interest' && m.manual_adjustment === true;
}
