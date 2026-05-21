import { formatBRL } from '@/lib/brFormat';

export function formatCentsBRL(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return '—';
  return formatBRL(cents / 100);
}

export function validateCommercialPayoutWarning(
  chargedCents: number | null,
  payoutCents: number | null,
): string | null {
  if (chargedCents == null || payoutCents == null) return null;
  if (payoutCents > chargedCents) {
    return 'O repasse não pode exceder o valor cobrado da farmácia.';
  }
  return null;
}

export type PharmacyCommercialForm = {
  delivery_fee_cents: number | null;
  delivery_fee_driver_payout_cents: number | null;
  minimum_guaranteed_cents: number | null;
  minimum_guaranteed_driver_payout_cents: number | null;
};

export const EMPTY_PHARMACY_COMMERCIAL: PharmacyCommercialForm = {
  delivery_fee_cents: null,
  delivery_fee_driver_payout_cents: null,
  minimum_guaranteed_cents: null,
  minimum_guaranteed_driver_payout_cents: null,
};
