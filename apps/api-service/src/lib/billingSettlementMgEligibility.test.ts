import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePairDeliverySettlement,
  isContractedDailyEligible,
  isFixedMgEligible,
  mgEnabledForPair,
} from './billingSettlementMgEligibility';

const eligibleBase = {
  driverType: 'fixed' as const,
  driverStatus: 'active' as const,
  inactiveAt: null as string | null,
  linkIsActive: true,
  pharmacyStatus: 'active' as const,
  pharmacyMgEnabled: true,
  activeDays: 7,
  cycleEnd: '2026-08-16',
};

const settlementBase = {
  minimumGuaranteedCents: 120000,
  minimumGuaranteedDriverPayoutCents: 90000,
  deliveryFeeCents: 1500,
  deliveryFeeDriverPayoutCents: 1200,
  minimumDeliveriesCount: 5,
};

describe('isFixedMgEligible', () => {
  it('fixo com overlap no ciclo gera MG mesmo desvinculado hoje', () => {
    assert.equal(isFixedMgEligible({ ...eligibleBase, linkIsActive: false, activeDays: 2 }), true);
  });

  it('diarista não gera MG', () => {
    assert.equal(isFixedMgEligible({ ...eligibleBase, driverType: 'daily' }), false);
  });

  it('status inativo hoje não apaga MG residual do overlap', () => {
    assert.equal(isFixedMgEligible({ ...eligibleBase, driverStatus: 'inactive', activeDays: 3 }), true);
  });

  it('inactive_at no ciclo não zera elegibilidade de MG (corta nos dias)', () => {
    assert.equal(isFixedMgEligible({ ...eligibleBase, inactiveAt: '2026-08-12', activeDays: 3 }), true);
  });

  it('sem overlap não gera MG', () => {
    assert.equal(isFixedMgEligible({ ...eligibleBase, activeDays: 0 }), false);
  });

  it('MG desligado na farmácia não gera MG, mas o vínculo segue válido para diária contratada', () => {
    assert.equal(isFixedMgEligible({ ...eligibleBase, pharmacyMgEnabled: false }), false);
    assert.equal(isContractedDailyEligible({ ...eligibleBase, pharmacyMgEnabled: false }), true);
  });

  it('bloqueado/inativo não é anfitrião de diária contratada', () => {
    assert.equal(isContractedDailyEligible({ ...eligibleBase, driverStatus: 'blocked', activeDays: 2 }), false);
    assert.equal(isContractedDailyEligible({ ...eligibleBase, driverStatus: 'inactive' }), false);
    assert.equal(isContractedDailyEligible({ ...eligibleBase, inactiveAt: '2026-08-12' }), false);
  });

  it('inactive_at depois do ciclo não impede anfitrião', () => {
    assert.equal(
      isContractedDailyEligible({ ...eligibleBase, inactiveAt: '2026-08-17', cycleEnd: '2026-08-16' }),
      true
    );
  });
});

describe('computePairDeliverySettlement', () => {
  it('fixo ativo abaixo do limiar aplica MG', () => {
    const r = computePairDeliverySettlement({
      ...settlementBase,
      mgEnabled: true,
      pairEligible: true,
      deliveryCount: 3,
    });
    assert.equal(r.appliedMinimumGuarantee, true);
    assert.equal(r.pharmacyChargeCents, 120000);
    assert.equal(r.driverPayoutCents, 90000);
  });

  it('diarista/sem overlap cobra só por entregas', () => {
    const r = computePairDeliverySettlement({
      ...settlementBase,
      mgEnabled: true,
      pairEligible: false,
      deliveryCount: 3,
    });
    assert.equal(r.appliedMinimumGuarantee, false);
    assert.equal(r.pharmacyChargeCents, 3 * 1500);
    assert.equal(r.driverPayoutCents, 3 * 1200);
  });

  it('sem overlap e 0 entregas não gera MG', () => {
    const r = computePairDeliverySettlement({
      ...settlementBase,
      mgEnabled: true,
      pairEligible: false,
      deliveryCount: 0,
    });
    assert.equal(r.appliedMinimumGuarantee, false);
    assert.equal(r.pharmacyChargeCents, 0);
    assert.equal(r.driverPayoutCents, 0);
  });

  it('mgEnabledForPair exige farmácia com MG e par elegível', () => {
    assert.equal(mgEnabledForPair(true, true), true);
    assert.equal(mgEnabledForPair(true, false), false);
    assert.equal(mgEnabledForPair(false, true), false);
  });
});
