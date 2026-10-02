import { splitAmountCents } from '@plataforma/billing-engine';
import { isPaidFinancialLock } from './billingSettlementReopen';

export type PreservedInvoiceRow = {
  pharmacy_id: string;
  entity_type: string;
  status?: string | null;
  amount_paid_cents?: number | null;
  force_preserve?: boolean;
};

/** Farmácias cujas faturas devem ser apagadas/recriadas (operacional + centro de custo). */
export function collectInvoicePharmacyIds(input: {
  operationalPharmacyId: string;
  billingPharmacyId?: string | null;
  invoicePharmacyIdsFromLines?: string[];
}): string[] {
  const ids = new Set<string>([input.operationalPharmacyId]);
  if (input.billingPharmacyId) ids.add(String(input.billingPharmacyId));
  for (const id of input.invoicePharmacyIdsFromLines || []) {
    if (id) ids.add(String(id));
  }
  return [...ids];
}

/**
 * Faturas já existentes que NÃO devem ser recriadas.
 * Farmácias em `forcePharmacyIds` só são preservadas se houver baixa/pago ou juros manual.
 */
export function invoiceKeysToSkip(preserved: PreservedInvoiceRow[], forcePharmacyIds: string[] = []): Set<string> {
  const force = new Set(forcePharmacyIds.map(String));
  const keys = new Set<string>();
  for (const row of preserved) {
    const pharmacyId = String(row.pharmacy_id);
    const key = `${pharmacyId}:${String(row.entity_type)}`;
    if (row.force_preserve) {
      keys.add(key);
      continue;
    }
    if (!force.has(pharmacyId)) {
      keys.add(key);
      continue;
    }
    if (isPaidFinancialLock(String(row.status || ''), row.amount_paid_cents)) {
      keys.add(key);
    }
  }
  return keys;
}

export function settlementSplitMatchesCadastro(input: {
  pharmacyChargeCents: number;
  coopCents: number;
  fluxCents: number;
  coopPct: number;
  fluxPct: number;
}): boolean {
  const expected = splitAmountCents(input.pharmacyChargeCents, {
    coopPct: input.coopPct,
    fluxPct: input.fluxPct,
  });
  return expected.coopCents === input.coopCents && expected.fluxCents === input.fluxCents;
}
