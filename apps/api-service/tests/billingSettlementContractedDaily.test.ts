import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyContractedDailyAllocations,
  buildContractedDailySettlementLine,
  financialDailyBelongsToCycle,
  selectContractedDailyHost,
} from '../src/lib/billingContractedDaily.ts';

type DailyLine = {
  kind: string;
  description: string | null;
  pharmacy_amount_cents: number;
  driver_amount_cents: number;
  metadata?: Record<string, unknown>;
};

describe('buildContractedDailySettlementLine', () => {
  it('gera cobrança da farmácia sem repasse no acerto semanal', () => {
    const line = buildContractedDailySettlementLine({
      pharmacy: {
        daily_billing_rule: 'fixed_per_driver_cycle',
        daily_billing_pharmacy_amount_cents: 28000,
        daily_billing_driver_payout_cents: 25000,
      },
      quantity: 1,
      eligibility: { activeDays: 7, totalCycleDays: 7 },
    });
    assert.equal(line.kind, 'daily');
    assert.equal(line.pharmacy_amount_cents, 28000);
    assert.equal(line.driver_amount_cents, 0);
    assert.equal(line.metadata?.allocation_rule, 'pharmacy_contracted_daily');
    assert.equal(line.metadata?.contracted_driver_payout_reference_cents, 25000);
  });
});

describe('applyContractedDailyAllocations', () => {
  const pharmacy = {
    id: 'ph-1',
    status: 'active' as const,
    daily_billing_enabled: true,
    daily_billing_rule: 'fixed_per_driver_cycle' as const,
    daily_billing_quantity: 1,
    daily_billing_pharmacy_amount_cents: 28000,
    daily_billing_driver_payout_cents: 25000,
  };

  it('adiciona diária contratada para fixo sem lançamento financeiro', () => {
    const dailyAllocationsByPair = new Map<string, DailyLine[]>();
    const pairCounts = new Map<string, number>();
    applyContractedDailyAllocations({
      pharmacyById: new Map([[pharmacy.id, pharmacy]]),
      fixedEligibilities: [
        {
          driverId: 'drv-1',
          pharmacyId: pharmacy.id,
          activeDays: 7,
          totalCycleDays: 7,
        },
      ],
      dailyAllocationsByPair,
      pairCounts,
    });
    const lines = dailyAllocationsByPair.get('drv-1:ph-1') || [];
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.pharmacy_amount_cents, 28000);
    assert.equal(pairCounts.has('drv-1:ph-1'), true);
  });

  it('cobre apenas uma diária por farmácia no ciclo com vários fixos', () => {
    const dailyAllocationsByPair = new Map<string, DailyLine[]>();
    const pairCounts = new Map<string, number>();
    applyContractedDailyAllocations({
      pharmacyById: new Map([[pharmacy.id, pharmacy]]),
      fixedEligibilities: [
        {
          driverId: 'drv-2',
          pharmacyId: pharmacy.id,
          activeDays: 7,
          totalCycleDays: 7,
        },
        {
          driverId: 'drv-1',
          pharmacyId: pharmacy.id,
          activeDays: 7,
          totalCycleDays: 7,
        },
      ],
      dailyAllocationsByPair,
      pairCounts,
    });
    assert.equal((dailyAllocationsByPair.get('drv-1:ph-1') || []).length, 1);
    assert.equal(dailyAllocationsByPair.get('drv-2:ph-1'), undefined);
  });

  it('não duplica quando já há diária financeira na farmácia', () => {
    const dailyAllocationsByPair = new Map<string, DailyLine[]>([
      [
        'drv-2:ph-1',
        [
          {
            kind: 'daily',
            description: 'Diária financeira',
            pharmacy_amount_cents: 28000,
            driver_amount_cents: 0,
            metadata: { financial_entry_id: 'fe-1' },
          },
        ],
      ],
    ]);
    const pairCounts = new Map<string, number>([['drv-2:ph-1', 0]]);
    applyContractedDailyAllocations({
      pharmacyById: new Map([[pharmacy.id, pharmacy]]),
      fixedEligibilities: [
        {
          driverId: 'drv-1',
          pharmacyId: pharmacy.id,
          activeDays: 7,
          totalCycleDays: 7,
        },
        {
          driverId: 'drv-2',
          pharmacyId: pharmacy.id,
          activeDays: 7,
          totalCycleDays: 7,
        },
      ],
      dailyAllocationsByPair,
      pairCounts,
    });
    assert.equal((dailyAllocationsByPair.get('drv-2:ph-1') || []).length, 1);
    assert.equal(dailyAllocationsByPair.get('drv-1:ph-1'), undefined);
  });

  it('não conta diária financeira R$ 0 / pending_audit no saldo contratado', () => {
    const dailyAllocationsByPair = new Map<string, DailyLine[]>([
      [
        'drv-francisco:ph-1',
        [
          {
            kind: 'daily',
            description: 'Diária pendente de auditoria',
            pharmacy_amount_cents: 0,
            driver_amount_cents: 0,
            metadata: {
              financial_entry_id: 'fe-zero',
              billing_treatment: 'pending_audit',
              allocation_rule: 'fallback_without_share_group',
            },
          },
        ],
      ],
    ]);
    const pairCounts = new Map<string, number>([['drv-francisco:ph-1', 0]]);
    applyContractedDailyAllocations({
      pharmacyById: new Map([[pharmacy.id, pharmacy]]),
      fixedEligibilities: [
        {
          driverId: 'drv-1',
          pharmacyId: pharmacy.id,
          activeDays: 7,
          totalCycleDays: 7,
        },
      ],
      dailyAllocationsByPair,
      pairCounts,
    });
    const contracted = dailyAllocationsByPair.get('drv-1:ph-1') || [];
    assert.equal(contracted.length, 1);
    assert.equal(contracted[0]!.pharmacy_amount_cents, 28000);
    assert.equal(contracted[0]!.metadata?.allocation_rule, 'pharmacy_contracted_daily');
    assert.equal((dailyAllocationsByPair.get('drv-francisco:ph-1') || []).length, 1);
  });

  it('completa saldo contratado quando qty > 1 e já existe diária financeira', () => {
    const pharmacyQty2 = { ...pharmacy, daily_billing_quantity: 2 };
    const dailyAllocationsByPair = new Map<string, DailyLine[]>([
      [
        'drv-2:ph-1',
        [
          {
            kind: 'daily',
            description: 'Diária financeira',
            pharmacy_amount_cents: 28000,
            driver_amount_cents: 0,
            metadata: { financial_entry_id: 'fe-1' },
          },
        ],
      ],
    ]);
    const pairCounts = new Map<string, number>([['drv-2:ph-1', 0]]);
    applyContractedDailyAllocations({
      pharmacyById: new Map([[pharmacyQty2.id, pharmacyQty2]]),
      fixedEligibilities: [
        {
          driverId: 'drv-1',
          pharmacyId: pharmacy.id,
          activeDays: 7,
          totalCycleDays: 7,
        },
      ],
      dailyAllocationsByPair,
      pairCounts,
    });
    const lines = dailyAllocationsByPair.get('drv-1:ph-1') || [];
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.metadata?.contracted_quantity, 1);
    assert.equal(lines[0]!.pharmacy_amount_cents, 28000);
  });

  it('pendura cobrança contratada na diária financeira aprovada, não no fixo de menor UUID', () => {
    const dailyAllocationsByPair = new Map<string, DailyLine[]>([
      [
        'drv-francisco:ph-1',
        [
          {
            kind: 'daily',
            description: 'Crédito diária Francisco',
            pharmacy_amount_cents: 0,
            driver_amount_cents: 0,
            metadata: {
              financial_entry_id: 'fe-140',
              billing_treatment: 'pending_audit',
              allocation_rule: 'fallback_without_share_group',
              settlement_driver_amount_excluded_cents: 14000,
            },
          },
        ],
      ],
    ]);
    const pairCounts = new Map<string, number>([['drv-francisco:ph-1', 0]]);
    applyContractedDailyAllocations({
      pharmacyById: new Map([[pharmacy.id, pharmacy]]),
      fixedEligibilities: [
        {
          driverId: 'drv-rodrigo',
          pharmacyId: pharmacy.id,
          activeDays: 7,
          totalCycleDays: 7,
        },
      ],
      dailyAllocationsByPair,
      pairCounts,
    });
    const francisco = dailyAllocationsByPair.get('drv-francisco:ph-1') || [];
    assert.equal(francisco.length, 1);
    assert.equal(francisco[0]!.pharmacy_amount_cents, 28000);
    assert.equal(francisco[0]!.metadata?.allocation_rule, 'financial_daily_covers_contracted');
    assert.equal(francisco[0]!.metadata?.contracted_quantity, 1);
    assert.equal(francisco[0]!.metadata?.financial_entry_id, 'fe-140');
    assert.equal(dailyAllocationsByPair.get('drv-rodrigo:ph-1'), undefined);
  });

  it('pendura a diária contratada no fixo com mais dias vigentes, não no menor UUID', () => {
    const dailyAllocationsByPair = new Map<string, DailyLine[]>();
    const pairCounts = new Map<string, number>();
    applyContractedDailyAllocations({
      pharmacyById: new Map([[pharmacy.id, pharmacy]]),
      fixedEligibilities: [
        {
          driverId: '6bf255dd-tania',
          pharmacyId: pharmacy.id,
          activeDays: 2,
          totalCycleDays: 7,
        },
        {
          driverId: '8292ca5b-eric',
          pharmacyId: pharmacy.id,
          activeDays: 7,
          totalCycleDays: 7,
        },
      ],
      dailyAllocationsByPair,
      pairCounts,
    });
    assert.equal((dailyAllocationsByPair.get('8292ca5b-eric:ph-1') || []).length, 1);
    assert.equal(dailyAllocationsByPair.get('6bf255dd-tania:ph-1'), undefined);
    assert.equal(selectContractedDailyHost([
      { driverId: '6bf255dd-tania', pharmacyId: pharmacy.id, activeDays: 2, totalCycleDays: 7 },
      { driverId: '8292ca5b-eric', pharmacyId: pharmacy.id, activeDays: 7, totalCycleDays: 7 },
    ])?.driverId, '8292ca5b-eric');
  });
});

describe('financialDailyBelongsToCycle', () => {
  it('usa event_date quando a diária de cobertura tem data do evento', () => {
    assert.equal(
      financialDailyBelongsToCycle({
        eventDate: '2026-08-16',
        startDate: '2026-08-18',
        apuracaoStart: '2026-08-10',
        apuracaoEnd: '2026-08-16',
      }),
      true
    );
    assert.equal(
      financialDailyBelongsToCycle({
        eventDate: '2026-08-09',
        startDate: '2026-08-11',
        apuracaoStart: '2026-08-10',
        apuracaoEnd: '2026-08-16',
      }),
      false
    );
  });

  it('cai para start_date quando não há event_date', () => {
    assert.equal(
      financialDailyBelongsToCycle({
        eventDate: null,
        startDate: '2026-08-11',
        apuracaoStart: '2026-08-10',
        apuracaoEnd: '2026-08-16',
      }),
      true
    );
  });
});
