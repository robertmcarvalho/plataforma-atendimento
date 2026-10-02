import { isBillingNfseEnabled } from './billingNfseConfig';

/** Colunas da migration 116 (NFS-e) — não existem em produção até o gate de homologação. */
export const PHARMACY_NFSE_WRITE_KEYS = ['ibge_city_code', 'municipal_registration'] as const;

/** Colunas da migration 118 — `billing_invoices.revenue_line` não existe em produção. */
export const INVOICE_NFSE_WRITE_KEYS = ['revenue_line'] as const;

export const BILLING_INVOICE_APPROVE_SELECT_CORE =
  'id, workspace_id, billing_cycle_id, pharmacy_id, entity_type, status, total_cents, amount_paid_cents, public_token, due_date' as const;

export const BILLING_INVOICE_APPROVE_SELECT_NFSE =
  'id, workspace_id, billing_cycle_id, pharmacy_id, entity_type, status, total_cents, amount_paid_cents, public_token, due_date, revenue_line, billing_invoice_lines(metadata)' as const;

/**
 * Remove campos NFS-e do write em `pharmacies` enquanto BILLING_NFSE_ENABLED está off.
 * Evita PGRST204 (schema cache) ao salvar diárias / cadastro no mesmo PUT.
 */
export function omitPharmacyNfseWriteColumns(row: Record<string, unknown>): Record<string, unknown> {
  return omitNfseKeys(row, PHARMACY_NFSE_WRITE_KEYS);
}

/** Remove `revenue_line` (e futuras colunas NFS-e) do insert/update de `billing_invoices` com a flag off. */
export function omitInvoiceNfseWriteColumns(row: Record<string, unknown>): Record<string, unknown> {
  return omitNfseKeys(row, INVOICE_NFSE_WRITE_KEYS);
}

/**
 * SELECT de fatura no approve. Com NFS-e off, não pede `revenue_line` (migration 118)
 * nem `billing_invoice_lines` (só usados para resolver perfil NFS-e).
 */
export function billingInvoiceApproveSelect(nfseEnabled = isBillingNfseEnabled()): string {
  return nfseEnabled ? BILLING_INVOICE_APPROVE_SELECT_NFSE : BILLING_INVOICE_APPROVE_SELECT_CORE;
}

function omitNfseKeys(row: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const next = { ...row };
  if (isBillingNfseEnabled()) return next;
  for (const key of keys) delete next[key];
  return next;
}
