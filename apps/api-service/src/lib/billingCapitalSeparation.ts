export const DRE_SCOPE_OPERATIONAL = 'operational' as const;
export const DRE_SCOPE_OUTSIDE_MARGIN = 'outside_margin' as const;

export type DreScope = typeof DRE_SCOPE_OPERATIONAL | typeof DRE_SCOPE_OUTSIDE_MARGIN;

/** Descontos de folha tratados como financeiro cooperativo (fora da margem DRE da farmácia). */
export const FINANCIAL_COOP_DISCOUNT_SLUGS = new Set([
  'quota',
  'advance',
  'uniform',
  'bag',
  'digital_cert',
]);

export const FINANCIAL_COOP_SETTLEMENT_LINE_KINDS = new Set([
  'quota',
  'advance',
  'uniform',
  'bag',
  'other_discount',
]);

export type FinancialCoopDiscountLine = {
  kind: string;
  amount_cents: number;
  description: string | null;
  installment_id: string;
  entry_type_slug: string;
};

export function isBillingCapitalSeparationEnabled(): boolean {
  const raw = String(process.env.BILLING_CAPITAL_SEPARATION_ENABLED ?? 'true').toLowerCase().trim();
  return raw !== 'false' && raw !== '0';
}

export function isFinancialCoopDiscountSlug(slug: string): boolean {
  return FINANCIAL_COOP_DISCOUNT_SLUGS.has(String(slug || '').toLowerCase());
}

export function financialLedgerEntryTypeForSlug(slug: string): string {
  const s = String(slug || '').toLowerCase();
  if (s === 'advance') return 'advance_recovery';
  if (s === 'uniform') return 'uniform_recovery';
  if (s === 'bag') return 'bag_recovery';
  if (s === 'digital_cert') return 'digital_cert_recovery';
  return 'other_financial_recovery';
}

export function settlementLineMetadata(scope: DreScope, extra: Record<string, unknown> = {}) {
  return {
    dre_scope: scope,
    cost_center_entity: scope === DRE_SCOPE_OUTSIDE_MARGIN ? 'coop_corporate' : 'pharmacy',
    ...extra,
  };
}

export const OFFBOARDING_CAPITAL_GROSS_KINDS = new Set(['quota_refund']);
export const OFFBOARDING_CAPITAL_DISCOUNT_KINDS = new Set(['quota', 'advance', 'uniform', 'bag', 'digital_cert', 'fine']);

export type OffboardingPreviewLine = { kind: string; amount_cents: number };

export type OffboardingPreviewTotals = {
  gross_cents: number;
  discount_cents: number;
  net_cents: number;
  operational_gross_cents: number;
  capital_gross_cents: number;
  operational_discount_cents: number;
  capital_discount_cents: number;
};

function sumOffboardingLines(lines: OffboardingPreviewLine[]): number {
  return lines.reduce((sum, line) => sum + Math.max(0, Number(line.amount_cents || 0)), 0);
}

export function syncOffboardingPreviewTotals(input: {
  gross_lines: OffboardingPreviewLine[];
  discount_lines: OffboardingPreviewLine[];
}): OffboardingPreviewTotals {
  const grossCents = sumOffboardingLines(input.gross_lines);
  const discountCents = sumOffboardingLines(input.discount_lines);
  const netCents = Math.max(0, grossCents - discountCents);
  const operationalGrossCents = sumOffboardingLines(
    input.gross_lines.filter((line) => !OFFBOARDING_CAPITAL_GROSS_KINDS.has(line.kind))
  );
  const capitalGrossCents = sumOffboardingLines(
    input.gross_lines.filter((line) => OFFBOARDING_CAPITAL_GROSS_KINDS.has(line.kind))
  );
  const operationalDiscountCents = sumOffboardingLines(
    input.discount_lines.filter((line) => line.kind === 'absence')
  );
  const capitalDiscountCents = sumOffboardingLines(
    input.discount_lines.filter((line) => OFFBOARDING_CAPITAL_DISCOUNT_KINDS.has(line.kind))
  );
  return {
    gross_cents: grossCents,
    discount_cents: discountCents,
    net_cents: netCents,
    operational_gross_cents: operationalGrossCents,
    capital_gross_cents: capitalGrossCents,
    operational_discount_cents: operationalDiscountCents,
    capital_discount_cents: capitalDiscountCents,
  };
}

export function computeSettlementPayoutBreakdown(input: {
  driverPayoutCents: number;
  driverExtras: number;
  operationalDiscountsCents: number;
  financialDeductionCents: number;
  capitalSeparationEnabled?: boolean;
  legacyDiscountsCents?: number;
}): {
  operational_net_driver_payout_cents: number;
  financial_deduction_cents: number;
  net_driver_payout_cents: number;
  discounts_cents: number;
} {
  const enabled = input.capitalSeparationEnabled ?? isBillingCapitalSeparationEnabled();
  const grossDriver = input.driverPayoutCents + input.driverExtras;

  if (!enabled) {
    const legacy = input.legacyDiscountsCents ?? input.operationalDiscountsCents + input.financialDeductionCents;
    const net = Math.max(0, grossDriver - legacy);
    return {
      operational_net_driver_payout_cents: net,
      financial_deduction_cents: 0,
      net_driver_payout_cents: net,
      discounts_cents: legacy,
    };
  }

  const operationalNet = Math.max(0, grossDriver - input.operationalDiscountsCents);
  const financialDeduction = Math.max(0, input.financialDeductionCents);
  const netPayout = Math.max(0, operationalNet - financialDeduction);
  return {
    operational_net_driver_payout_cents: operationalNet,
    financial_deduction_cents: financialDeduction,
    net_driver_payout_cents: netPayout,
    discounts_cents: input.operationalDiscountsCents + financialDeduction,
  };
}
