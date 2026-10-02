import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dayBaseLinesForPair, DAY_BASE_ALLOCATION_RULE } from './billingSettlementDayBaseCore';

describe('dayBaseLinesForPair', () => {
  const overlays = [
    {
      id: 'ov-1',
      driverId: 'drv-1',
      pharmacyId: 'ph-1',
      eventDate: '2026-08-18',
      amountCents: 10000,
    },
    {
      id: 'ov-2',
      driverId: 'drv-1',
      pharmacyId: 'ph-1',
      eventDate: '2026-08-19',
      amountCents: 9000,
    },
  ];

  it('cobra farmácia pelo cadastro e repassa o valor do overlay ao entregador', () => {
    const lines = dayBaseLinesForPair(overlays, 'drv-1', 'ph-1', 14300);
    assert.equal(lines.length, 2);
    assert.equal(lines[0]?.pharmacy_amount_cents, 14300);
    assert.equal(lines[0]?.driver_amount_cents, 10000);
    assert.equal(lines[1]?.pharmacy_amount_cents, 14300);
    assert.equal(lines[1]?.driver_amount_cents, 9000);
    assert.equal(lines[0]?.metadata?.allocation_rule, DAY_BASE_ALLOCATION_RULE);
    assert.equal(lines[0]?.metadata?.pharmacy_day_base_cents, 14300);
    assert.equal(lines[0]?.metadata?.driver_day_base_cents, 10000);
  });

  it('ignora overlays de outro par ou com valor zero', () => {
    const lines = dayBaseLinesForPair(
      [
        ...overlays,
        { id: 'ov-3', driverId: 'drv-2', pharmacyId: 'ph-1', eventDate: '2026-08-18', amountCents: 5000 },
        { id: 'ov-4', driverId: 'drv-1', pharmacyId: 'ph-1', eventDate: '2026-08-20', amountCents: 0 },
      ],
      'drv-1',
      'ph-1',
      14300
    );
    assert.equal(lines.length, 2);
  });
});
