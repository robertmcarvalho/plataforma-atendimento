/** Lançamentos elegíveis para pagamento / PIX / totais de conferência. */
export const PAYABLE_FINANCIAL_ENTRY_STATUSES = ['active', 'approved', 'settled'] as const;

export type PayableFinancialEntryStatus = (typeof PAYABLE_FINANCIAL_ENTRY_STATUSES)[number];

export function isPayableFinancialEntryStatus(status: string | null | undefined): boolean {
  const s = String(status || '').toLowerCase();
  return (PAYABLE_FINANCIAL_ENTRY_STATUSES as readonly string[]).includes(s);
}

/** Parcela ainda não quitada (pendente ou vencida). */
export function isOpenInstallmentStatus(status: string | null | undefined): boolean {
  const s = String(status || '').toLowerCase();
  return s === 'pending' || s === 'overdue';
}

/** Rótulo de status para exportação (inclui legado: draft + rejection_reason). */
export function financialEntryExportStatusLabel(
  status: string | null | undefined,
  rejectionReason?: string | null,
): string {
  const s = String(status || '').toLowerCase();
  if (s === 'rejected') return 'Rejeitado';
  if (s === 'draft' && rejectionReason) return 'Rejeitado';
  const map: Record<string, string> = {
    draft: 'Rascunho',
    pending_approval: 'Aguardando aprovação',
    active: 'Ativo',
    approved: 'Aprovado',
    settled: 'Liquidado',
    cancelled: 'Cancelado',
    partially_cancelled: 'Parcialmente cancelado',
    informed: 'Informativo',
  };
  return map[s] || status || '';
}
