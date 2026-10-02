import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { settlementDailyDriverAmountOutsideWeeklyPix } from '../src/lib/billingPayablesDailyExclude.ts';

describe('settlementDailyDriverAmountOutsideWeeklyPix', () => {
  it('soma só o resíduo legado da trilha de terça', () => {
    assert.equal(
      settlementDailyDriverAmountOutsideWeeklyPix([
        { kind: 'deliveries', driver_amount_cents: 10_000 },
        { kind: 'daily', driver_amount_cents: 15_000 },
        { kind: 'daily', driver_amount_cents: 0, metadata: { driver_payout_track: 'financial_daily' } },
        { kind: 'absence', driver_amount_cents: -2_000 },
      ]),
      15_000
    );
  });

  it('retorna 0 quando diárias já estão zeradas na trilha financial_daily', () => {
    assert.equal(
      settlementDailyDriverAmountOutsideWeeklyPix([
        {
          kind: 'daily',
          driver_amount_cents: 0,
          metadata: { driver_payout_track: 'financial_daily', settlement_driver_amount_excluded_cents: 18_000 },
        },
      ]),
      0
    );
  });

  it('não subtrai a diária-base de escala do A pagar semanal', () => {
    assert.equal(
      settlementDailyDriverAmountOutsideWeeklyPix([
        { kind: 'deliveries', driver_amount_cents: 102_690 },
        {
          kind: 'daily',
          driver_amount_cents: 10_000,
          metadata: { allocation_rule: 'pharmacy_day_base', pay_track: 'thursday_settlement' },
        },
      ]),
      0
    );
  });
});
