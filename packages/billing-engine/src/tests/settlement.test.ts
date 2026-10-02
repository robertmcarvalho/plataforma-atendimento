import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeAbsenceMgDiscount,
  computeDeliverySettlement,
  computeMinimumDeliveryThreshold,
  resolveSplitPercentages,
  splitAmountCents,
} from '../settlement';

describe('computeMinimumDeliveryThreshold', () => {
  it('usa override explícito da farmácia', () => {
    assert.equal(
      computeMinimumDeliveryThreshold({
        minimumDeliveriesCount: 12,
        minimumGuaranteedDriverPayoutCents: 60000,
        deliveryFeeDriverPayoutCents: 1000,
      }),
      12
    );
  });

  it('deriva do repasse MG ÷ taxa entrega', () => {
    assert.equal(
      computeMinimumDeliveryThreshold({
        minimumGuaranteedDriverPayoutCents: 60000,
        deliveryFeeDriverPayoutCents: 15000,
      }),
      4
    );
  });
});

describe('computeDeliverySettlement', () => {
  const base = {
    mgEnabled: true,
    minimumGuaranteedCents: 120000,
    minimumGuaranteedDriverPayoutCents: 90000,
    deliveryFeeCents: 1500,
    deliveryFeeDriverPayoutCents: 1200,
    minimumDeliveriesCount: 5,
  };

  it('aplica MG quando entregas <= limiar', () => {
    const r = computeDeliverySettlement({ ...base, deliveryCount: 3 });
    assert.equal(r.appliedMinimumGuarantee, true);
    assert.equal(r.pharmacyChargeCents, 120000);
    assert.equal(r.driverPayoutCents, 90000);
  });

  it('cobra por entrega acima do limiar', () => {
    const r = computeDeliverySettlement({ ...base, deliveryCount: 8 });
    assert.equal(r.appliedMinimumGuarantee, false);
    assert.equal(r.pharmacyChargeCents, 8 * 1500);
    assert.equal(r.driverPayoutCents, 8 * 1200);
  });
});

describe('computeAbsenceMgDiscount', () => {
  it('divide MG por 6', () => {
    const r = computeAbsenceMgDiscount({
      minimumGuaranteedCents: 60000,
      minimumGuaranteedDriverPayoutCents: 48000,
    });
    assert.equal(r.pharmacyDiscountCents, 10000);
    assert.equal(r.driverDiscountCents, 8000);
  });
});

describe('resolveSplitPercentages', () => {
  it('100% coop quando coop_only', () => {
    assert.deepEqual(resolveSplitPercentages({ contractScope: 'coop_only' }), { coopPct: 100, fluxPct: 0 });
  });

  it('prioriza override de split da farmácia em both', () => {
    assert.deepEqual(
      resolveSplitPercentages({
        contractScope: 'both',
        pharmacySplitCoopPct: 40,
        pharmacySplitFluxPct: 60,
        costCenterSplitCoopPct: 70,
        costCenterSplitFluxPct: 30,
      }),
      { coopPct: 40, fluxPct: 60 }
    );
  });
});

describe('splitAmountCents', () => {
  it('rateia com arredondamento coop-first', () => {
    const r = splitAmountCents(10001, { coopPct: 70, fluxPct: 30 });
    assert.equal(r.coopCents + r.fluxCents, 10001);
    assert.equal(r.coopCents, 7001);
    assert.equal(r.fluxCents, 3000);
  });
});
