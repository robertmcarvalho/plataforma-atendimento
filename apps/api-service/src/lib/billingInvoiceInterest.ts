/**
 * Pure helpers for invoice interest (juros / diferença de crédito) MVP.
 * Interest increases invoice total so bank credit can match exactly.
 */

export type InvoiceInterestLineMetadata = {
  kind: 'interest';
  manual_adjustment: true;
  nfse_exclude: true;
  reason: string;
  source_movement_id?: string | null;
  created_by?: string | null;
  created_at?: string;
};

export function isManualInterestLine(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  const m = metadata as Record<string, unknown>;
  return m.kind === 'interest' && m.manual_adjustment === true;
}

/** Cents of interest needed so available balance equals credit (0 if credit <= balance). */
export function interestCentsForCredit(input: {
  invoiceTotalCents: number;
  amountPaidCents: number;
  pendingUnreconciledCents?: number;
  creditCents: number;
}): number {
  const pending = Math.max(0, Number(input.pendingUnreconciledCents || 0));
  const available = Number(input.invoiceTotalCents) - Number(input.amountPaidCents) - pending;
  const credit = Number(input.creditCents);
  if (!Number.isFinite(available) || !Number.isFinite(credit)) return 0;
  if (credit <= available) return 0;
  return Math.round(credit - available);
}

export function buildInterestLineMetadata(input: {
  reason: string;
  createdBy?: string | null;
  sourceMovementId?: string | null;
  createdAt?: string;
}): InvoiceInterestLineMetadata {
  const reason = String(input.reason || '').trim();
  return {
    kind: 'interest',
    manual_adjustment: true,
    nfse_exclude: true,
    reason,
    source_movement_id: input.sourceMovementId || null,
    created_by: input.createdBy || null,
    created_at: input.createdAt || new Date().toISOString(),
  };
}

export function validateInterestReason(reason: unknown): string | null {
  const text = String(reason || '').trim();
  if (text.length < 3) return 'Motivo dos juros é obrigatório (mínimo 3 caracteres).';
  if (text.length > 500) return 'Motivo dos juros excede 500 caracteres.';
  return null;
}

/** Invoice should not be wiped on regen when it has manual interest lines. */
export function invoiceHasPreservableInterest(
  lines: Array<{ metadata?: unknown }> | null | undefined
): boolean {
  return (lines || []).some((line) => isManualInterestLine(line.metadata));
}
