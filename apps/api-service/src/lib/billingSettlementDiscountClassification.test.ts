import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifySettlementDiscountCents,
  isManualDiscountLine,
  isPharmacyGroupManualDiscount,
  MANUAL_DISCOUNT_SOURCE,
  PHARMACY_GROUP_SCOPE,
} from './billingSettlementDiscountClassification';
import {
  pickAnchorSettlement,
  snapshotFromManualDiscountLine,
} from './billingSettlementManualDiscountHelpers';

describe('billingSettlementDiscountClassification', () => {
  it('identifica linhas de desconto manual pelo metadata.source', () => {
    assert.equal(isManualDiscountLine({ metadata: { source: MANUAL_DISCOUNT_SOURCE } }), true);
    assert.equal(isManualDiscountLine({ metadata: { source: 'financial_entry' } }), false);
    assert.equal(isManualDiscountLine({ metadata: null }), false);
  });

  it('identifica desconto de grupo da farmácia', () => {
    assert.equal(
      isPharmacyGroupManualDiscount({
        metadata: { source: MANUAL_DISCOUNT_SOURCE, scope: PHARMACY_GROUP_SCOPE },
      }),
      true
    );
    assert.equal(
      isPharmacyGroupManualDiscount({
        metadata: { source: MANUAL_DISCOUNT_SOURCE, target: 'pharmacy' },
      }),
      true
    );
    assert.equal(
      isPharmacyGroupManualDiscount({
        metadata: { source: MANUAL_DISCOUNT_SOURCE, target: 'driver' },
      }),
      false
    );
  });

  it('classifica desconto manual legado de entregador como operacional', () => {
    const result = classifySettlementDiscountCents([
      {
        kind: 'adjustment',
        driver_amount_cents: -1500,
        metadata: { source: MANUAL_DISCOUNT_SOURCE, target: 'driver' },
      },
    ]);
    assert.equal(result.operationalDiscountsCents, 1500);
    assert.equal(result.financialDeductionCents, 0);
  });

  it('ignora desconto manual da farmácia no cálculo de repasse', () => {
    const result = classifySettlementDiscountCents([
      {
        kind: 'adjustment',
        driver_amount_cents: 0,
        metadata: { source: MANUAL_DISCOUNT_SOURCE, scope: PHARMACY_GROUP_SCOPE, target: 'pharmacy' },
      },
      {
        kind: 'absence',
        driver_amount_cents: -800,
        metadata: {},
      },
    ]);
    assert.equal(result.operationalDiscountsCents, 800);
    assert.equal(result.financialDeductionCents, 0);
  });

  it('classifica descontos financeiros cooperativos fora da margem', () => {
    const result = classifySettlementDiscountCents([
      {
        kind: 'quota',
        driver_amount_cents: -2000,
        metadata: { dre_scope: 'outside_margin' },
      },
      {
        kind: 'absence',
        driver_amount_cents: -500,
        metadata: { dre_scope: 'operational' },
      },
    ]);
    assert.equal(result.financialDeductionCents, 2000);
    assert.equal(result.operationalDiscountsCents, 500);
  });
});

describe('billingSettlementManualDiscount helpers', () => {
  it('snapshotFromManualDiscountLine marca escopo pharmacy_group', () => {
    const snapshot = snapshotFromManualDiscountLine(
      { driver_id: 'd1', pharmacy_id: 'p1' },
      {
        id: 'line-1',
        kind: 'adjustment',
        description: 'Desconto manual (fatura): teste',
        pharmacy_amount_cents: -1000,
        driver_amount_cents: 0,
        metadata: { source: MANUAL_DISCOUNT_SOURCE, scope: PHARMACY_GROUP_SCOPE, target: 'pharmacy' },
      }
    );
    assert.equal(snapshot.scope, 'pharmacy_group');
    assert.equal(snapshot.pharmacy_id, 'p1');
    assert.equal(snapshot.driver_id, undefined);
    assert.equal(snapshot.pharmacy_amount_cents, -1000);
  });

  it('pickAnchorSettlement escolhe o primeiro entregador em ordem alfabética', () => {
    const anchor = pickAnchorSettlement([
      { id: 's2', status: 'open', driver_id: 'd2', drivers: { name: 'Zeca' } },
      { id: 's1', status: 'open', driver_id: 'd1', drivers: { name: 'Ana' } },
    ]);
    assert.equal(anchor?.id, 's1');
  });
});
