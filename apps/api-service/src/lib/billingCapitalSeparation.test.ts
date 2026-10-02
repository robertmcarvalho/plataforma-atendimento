import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSettlementPayoutBreakdown,
  isFinancialCoopDiscountSlug,
  financialLedgerEntryTypeForSlug,
  syncOffboardingPreviewTotals,
} from './billingCapitalSeparation';

describe('billingCapitalSeparation', () => {
  it('computeSettlementPayoutBreakdown — separa operacional e financeiro cooperativo', () => {
    const result = computeSettlementPayoutBreakdown({
      driverPayoutCents: 100_000,
      driverExtras: 0,
      operationalDiscountsCents: 10_000,
      financialDeductionCents: 25_000,
      capitalSeparationEnabled: true,
    });
    assert.equal(result.operational_net_driver_payout_cents, 90_000);
    assert.equal(result.financial_deduction_cents, 25_000);
    assert.equal(result.net_driver_payout_cents, 65_000);
    assert.equal(result.discounts_cents, 35_000);
  });

  it('computeSettlementPayoutBreakdown — faltas operacionais não entram no financeiro', () => {
    const result = computeSettlementPayoutBreakdown({
      driverPayoutCents: 50_000,
      driverExtras: 5_000,
      operationalDiscountsCents: 8_000,
      financialDeductionCents: 0,
      capitalSeparationEnabled: true,
    });
    assert.equal(result.operational_net_driver_payout_cents, 47_000);
    assert.equal(result.financial_deduction_cents, 0);
    assert.equal(result.net_driver_payout_cents, 47_000);
  });

  it('computeSettlementPayoutBreakdown — legado quando separação desligada', () => {
    const result = computeSettlementPayoutBreakdown({
      driverPayoutCents: 80_000,
      driverExtras: 0,
      operationalDiscountsCents: 5_000,
      financialDeductionCents: 15_000,
      capitalSeparationEnabled: false,
      legacyDiscountsCents: 20_000,
    });
    assert.equal(result.operational_net_driver_payout_cents, 60_000);
    assert.equal(result.financial_deduction_cents, 0);
    assert.equal(result.net_driver_payout_cents, 60_000);
  });

  it('isFinancialCoopDiscountSlug — cota e adiantamento fora da margem', () => {
    assert.equal(isFinancialCoopDiscountSlug('quota'), true);
    assert.equal(isFinancialCoopDiscountSlug('advance'), true);
    assert.equal(isFinancialCoopDiscountSlug('absence'), false);
  });

  it('financialLedgerEntryTypeForSlug — mapeia slugs de desconto', () => {
    assert.equal(financialLedgerEntryTypeForSlug('advance'), 'advance_recovery');
    assert.equal(financialLedgerEntryTypeForSlug('uniform'), 'uniform_recovery');
    assert.equal(financialLedgerEntryTypeForSlug('unknown'), 'other_financial_recovery');
  });
});

describe('syncOffboardingPreviewTotals', () => {
  it('separa repasse operacional e capital cooperativo no desligamento', () => {
    const payload = {
      driver: { id: 'd1', name: 'Test', cpf: null, pix_key: null },
      last_worked_at: '2026-06-01',
      open_cycles: [],
      ended_pharmacy_ids: [],
      gross_lines: [
        { kind: 'open_cycle_settlement', label: 'Ciclo', amount_cents: 80_000 },
        { kind: 'quota_refund', label: 'Cota', amount_cents: 20_000 },
      ],
      discount_lines: [
        { kind: 'absence', label: 'Falta', amount_cents: 5_000 },
        { kind: 'advance', label: 'Adiantamento', amount_cents: 10_000 },
      ],
      pending_quota_lines: [],
      existing_payables: [],
      warnings: [],
      totals: { gross_cents: 0, discount_cents: 0, net_cents: 0 },
    };
    const totals = syncOffboardingPreviewTotals(payload);
    assert.equal(totals.operational_gross_cents, 80_000);
    assert.equal(totals.capital_gross_cents, 20_000);
    assert.equal(totals.operational_discount_cents, 5_000);
    assert.equal(totals.capital_discount_cents, 10_000);
    assert.equal(totals.net_cents, 85_000);
  });
});
