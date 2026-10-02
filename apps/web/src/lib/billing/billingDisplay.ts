import { BillingSeedTag } from '@/components/billing/BillingSeedTag';

const SEED_PREFIX = /^\[ATIVMOB\]\s*/i;

export function pharmacyDisplayName(
  row?: { trade_name?: string | null; legal_name?: string | null; name?: string | null } | null
): string {
  if (!row) return '—';
  return cleanBillingLabel(String(row.trade_name || row.legal_name || row.name || '—'));
}

/** Remove prefixo de seed e normaliza rótulos na UI. */
export function cleanBillingLabel(name: string): string {
  return String(name || '')
    .replace(SEED_PREFIX, '')
    .trim() || '—';
}

export function isSeedBillingLabel(name: string): boolean {
  return SEED_PREFIX.test(String(name || ''));
}

export { BillingSeedTag };
