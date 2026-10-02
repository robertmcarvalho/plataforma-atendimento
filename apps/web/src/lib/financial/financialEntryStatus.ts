import { entryStatusLabel } from '@/lib/financial/financialLabels';

/** Lançamentos elegíveis para pagamento / totais de conferência (alinhado ao PIX diárias). */
export const PAYABLE_FINANCIAL_ENTRY_STATUSES = ['active', 'approved', 'settled'] as const;

export function isPayableFinancialEntryStatus(status: string | null | undefined): boolean {
  return PAYABLE_FINANCIAL_ENTRY_STATUSES.includes(
    String(status || '').toLowerCase() as (typeof PAYABLE_FINANCIAL_ENTRY_STATUSES)[number],
  );
}

export function financialEntryDisplayStatus(
  status: string,
  rejectionReason?: string | null,
): string {
  if (status === 'rejected') return 'Rejeitado';
  if (status === 'draft' && rejectionReason) return 'Rejeitado';
  return entryStatusLabel(status);
}
