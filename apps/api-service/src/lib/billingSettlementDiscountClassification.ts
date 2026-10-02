import {
  DRE_SCOPE_OUTSIDE_MARGIN,
  isBillingCapitalSeparationEnabled,
} from './billingCapitalSeparation';

export const MANUAL_DISCOUNT_SOURCE = 'manual_discount';
export const PHARMACY_GROUP_SCOPE = 'pharmacy_group';

export type SettlementDiscountLine = {
  kind: string;
  driver_amount_cents: number;
  metadata?: Record<string, unknown> | null;
};

export function isManualDiscountLine(line: { metadata?: Record<string, unknown> | null }): boolean {
  const meta = line.metadata && typeof line.metadata === 'object' ? line.metadata : {};
  return String(meta.source || '') === MANUAL_DISCOUNT_SOURCE;
}

export function isPharmacyGroupManualDiscount(line: { metadata?: Record<string, unknown> | null }): boolean {
  if (!isManualDiscountLine(line)) return false;
  const meta = line.metadata && typeof line.metadata === 'object' ? line.metadata : {};
  return meta.scope === PHARMACY_GROUP_SCOPE || meta.target === 'pharmacy';
}

function lineMetadata(line: SettlementDiscountLine): Record<string, unknown> {
  return line.metadata && typeof line.metadata === 'object' ? line.metadata : {};
}

export function classifySettlementDiscountCents(lines: SettlementDiscountLine[]): {
  operationalDiscountsCents: number;
  financialDeductionCents: number;
} {
  const capitalSeparation = isBillingCapitalSeparationEnabled();
  let operationalDiscountsCents = 0;
  let financialDeductionCents = 0;

  for (const line of lines) {
    const meta = lineMetadata(line);
    const driverAmount = Number(line.driver_amount_cents || 0);
    if (driverAmount >= 0) continue;

    const discountCents = Math.abs(driverAmount);
    if (line.kind === 'absence') {
      operationalDiscountsCents += discountCents;
      continue;
    }

    if (isManualDiscountLine(line)) {
      const target = String(meta.target || 'pharmacy');
      if (target === 'pharmacy' || meta.scope === PHARMACY_GROUP_SCOPE) continue;
      operationalDiscountsCents += discountCents;
      continue;
    }

    const scope = String(meta.dre_scope || '');
    if (capitalSeparation && (scope === DRE_SCOPE_OUTSIDE_MARGIN || ['quota', 'advance', 'uniform', 'bag'].includes(line.kind))) {
      financialDeductionCents += discountCents;
    } else {
      operationalDiscountsCents += discountCents;
    }
  }

  return { operationalDiscountsCents, financialDeductionCents };
}
