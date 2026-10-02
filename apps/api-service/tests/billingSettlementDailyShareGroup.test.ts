import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DRE_ONLY_DAILY_ALLOCATION_RULE,
  isDreOnlyDailyAllocationRule,
  registerDailySettlementAllocation,
} from '../src/lib/billingDailySettlementAllocation.ts';

describe('isDreOnlyDailyAllocationRule', () => {
  it('identifica equal_daily_share_group como somente DRE', () => {
    assert.equal(isDreOnlyDailyAllocationRule(DRE_ONLY_DAILY_ALLOCATION_RULE), true);
    assert.equal(isDreOnlyDailyAllocationRule('fallback_without_share_group'), false);
    assert.equal(isDreOnlyDailyAllocationRule('pharmacy_contracted_daily'), false);
    assert.equal(isDreOnlyDailyAllocationRule('direct_pharmacy_without_group'), false);
  });
});

describe('registerDailySettlementAllocation', () => {
  const shareGroupLine = {
    kind: 'daily',
    description: 'Diária rateada por grupo',
    pharmacy_amount_cents: 9_333,
    driver_amount_cents: 0,
    metadata: {
      allocation_rule: DRE_ONLY_DAILY_ALLOCATION_RULE,
      group_id: 'grp-1',
      group_name: 'Pense Polo',
      financial_entry_id: 'fe-1',
    },
  };

  const fallbackLine = {
    kind: 'daily',
    description: 'Diária sem grupo',
    pharmacy_amount_cents: 28_000,
    driver_amount_cents: 0,
    metadata: {
      allocation_rule: 'fallback_without_share_group',
      financial_entry_id: 'fe-2',
    },
  };

  it('equal_daily_share_group não adiciona par em pairCounts nem dailyAllocationsByPair', () => {
    const dailyAllocationsByPair = new Map<string, typeof shareGroupLine[]>();
    const pairCounts = new Map<string, number>();
    const dreOnlyDailyAllocationsByPair = new Map<string, typeof shareGroupLine[]>();

    registerDailySettlementAllocation({
      driverId: 'drv-1',
      pharmacyId: 'ph-2',
      line: shareGroupLine,
      dailyAllocationsByPair,
      pairCounts,
      dreOnlyDailyAllocationsByPair,
    });

    assert.equal(pairCounts.has('drv-1:ph-2'), false);
    assert.equal(dailyAllocationsByPair.has('drv-1:ph-2'), false);
    assert.equal((dreOnlyDailyAllocationsByPair.get('drv-1:ph-2') || []).length, 1);
    assert.equal(dreOnlyDailyAllocationsByPair.get('drv-1:ph-2')![0]!.metadata?.group_name, 'Pense Polo');
  });

  it('várias farmácias do grupo não criam pares fantasma de acerto', () => {
    const dailyAllocationsByPair = new Map<string, typeof shareGroupLine[]>();
    const pairCounts = new Map<string, number>([['drv-1:ph-1', 5]]);
    const dreOnlyDailyAllocationsByPair = new Map<string, typeof shareGroupLine[]>();

    for (const pharmacyId of ['ph-1', 'ph-2', 'ph-3']) {
      registerDailySettlementAllocation({
        driverId: 'drv-1',
        pharmacyId,
        line: { ...shareGroupLine, pharmacy_amount_cents: 9_333 },
        dailyAllocationsByPair,
        pairCounts,
        dreOnlyDailyAllocationsByPair,
      });
    }

    assert.equal(pairCounts.size, 1);
    assert.equal(pairCounts.get('drv-1:ph-1'), 5);
    assert.equal(pairCounts.has('drv-1:ph-2'), false);
    assert.equal(pairCounts.has('drv-1:ph-3'), false);
    assert.equal(dailyAllocationsByPair.size, 0);
    assert.equal(dreOnlyDailyAllocationsByPair.size, 3);
  });

  it('fallback_without_share_group ainda registra par para acerto semanal', () => {
    const dailyAllocationsByPair = new Map<string, typeof fallbackLine[]>();
    const pairCounts = new Map<string, number>();

    registerDailySettlementAllocation({
      driverId: 'drv-1',
      pharmacyId: 'ph-1',
      line: fallbackLine,
      dailyAllocationsByPair,
      pairCounts,
    });

    assert.equal(pairCounts.has('drv-1:ph-1'), true);
    assert.equal(pairCounts.get('drv-1:ph-1'), 0);
    assert.equal((dailyAllocationsByPair.get('drv-1:ph-1') || []).length, 1);
    assert.equal(dailyAllocationsByPair.get('drv-1:ph-1')![0]!.metadata?.allocation_rule, 'fallback_without_share_group');
  });
});
