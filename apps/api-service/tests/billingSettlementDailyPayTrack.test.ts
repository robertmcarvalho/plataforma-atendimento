import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_PAY_TRACK_FINANCIAL_DAILY,
  DAILY_PAY_TRACK_WEEKLY_SETTLEMENT,
  dailyDriverPayoutInWeeklySettlementCents,
  dailyDriverPayoutOutsideWeeklySettlementCents,
  dailyDriverReferenceOnFinancialTrackCents,
  dailyLineHasStaleWeeklyPayout,
  dailyLineIsPaidInWeeklySettlement,
  resolveDailyPayTrack,
} from '../../../packages/billing-engine/src/dailyPayTrack.ts';
import { dayBaseLinesForPair } from '../src/lib/billingSettlementDayBaseCore.ts';
import { buildContractedDailySettlementLine } from '../src/lib/billingContractedDaily.ts';

type Line = {
  kind: string;
  driver_amount_cents: number;
  metadata?: Record<string, unknown>;
};

/** Linha da diária do Financeiro como o motor a grava hoje: repasse zerado, trilha terça. */
function financialDailyLine(driverCents: number): Line {
  return {
    kind: 'daily',
    driver_amount_cents: 0,
    metadata: {
      allocation_rule: 'direct_pharmacy_without_group',
      pay_track: DAILY_PAY_TRACK_FINANCIAL_DAILY,
      driver_payout_track: DAILY_PAY_TRACK_FINANCIAL_DAILY,
      settlement_driver_amount_excluded_cents: driverCents,
      financial_entry_id: 'fe-1',
    },
  };
}

/** Diária-base de escala: repasse real na linha, trilha quinta. */
function dayBaseLine(driverCents: number): Line {
  const [line] = dayBaseLinesForPair(
    [
      {
        id: 'ov-1',
        driverId: 'drv-1',
        pharmacyId: 'ph-1',
        eventDate: '2026-08-15',
        amountCents: driverCents,
      },
    ],
    'drv-1',
    'ph-1',
    14300
  );
  return line as Line;
}

describe('resolveDailyPayTrack', () => {
  it('diária-base de escala vai para o acerto de quinta', () => {
    const line = dayBaseLine(10_000);
    assert.equal(line.metadata?.allocation_rule, 'pharmacy_day_base');
    assert.equal(resolveDailyPayTrack(line), DAILY_PAY_TRACK_WEEKLY_SETTLEMENT);
    assert.equal(dailyLineIsPaidInWeeklySettlement(line), true);
  });

  it('diária do Financeiro fica na trilha Diárias (terça)', () => {
    const line = financialDailyLine(18_000);
    assert.equal(resolveDailyPayTrack(line), DAILY_PAY_TRACK_FINANCIAL_DAILY);
    assert.equal(dailyLineIsPaidInWeeklySettlement(line), false);
  });

  it('diária contratada do cadastro é cobrança-espelho na trilha de terça', () => {
    const line = buildContractedDailySettlementLine({
      pharmacy: {
        daily_billing_rule: 'fixed_per_driver_cycle',
        daily_billing_pharmacy_amount_cents: 28_000,
        daily_billing_driver_payout_cents: 25_000,
      },
      quantity: 1,
    });
    assert.equal(line.driver_amount_cents, 0);
    assert.equal(resolveDailyPayTrack(line), DAILY_PAY_TRACK_FINANCIAL_DAILY);
    assert.equal(dailyLineIsPaidInWeeklySettlement(line), false);
  });

  it('linha legada sem etiqueta cai na trilha de terça (default anti-duplicidade)', () => {
    const legacy: Line = {
      kind: 'daily',
      driver_amount_cents: 14_000,
      metadata: { allocation_rule: 'direct_pharmacy_without_group', financial_entry_id: 'fe-legacy' },
    };
    assert.equal(resolveDailyPayTrack(legacy), DAILY_PAY_TRACK_FINANCIAL_DAILY);
    assert.equal(dailyLineIsPaidInWeeklySettlement(legacy), false);
    assert.equal(resolveDailyPayTrack({ kind: 'daily', driver_amount_cents: 9_900 }), DAILY_PAY_TRACK_FINANCIAL_DAILY);
  });

  it('infere quinta por allocation_rule quando a diária-base perdeu a etiqueta', () => {
    const line: Line = {
      kind: 'daily',
      driver_amount_cents: 10_000,
      metadata: { allocation_rule: 'pharmacy_day_base' },
    };
    assert.equal(resolveDailyPayTrack(line), DAILY_PAY_TRACK_WEEKLY_SETTLEMENT);
  });

  it('ignora linhas que não são diária', () => {
    assert.equal(resolveDailyPayTrack({ kind: 'deliveries', driver_amount_cents: 102_690 }), null);
    assert.equal(resolveDailyPayTrack({ kind: 'absence', driver_amount_cents: -2_000 }), null);
    assert.equal(dailyLineIsPaidInWeeklySettlement({ kind: 'deliveries', driver_amount_cents: 1 }), false);
  });
});

describe('dailyDriverPayoutOutsideWeeklySettlementCents', () => {
  it('não subtrai a diária-base do PIX de quinta', () => {
    const lines = [
      { kind: 'deliveries', driver_amount_cents: 102_690 },
      dayBaseLine(10_000),
    ];
    assert.equal(dailyDriverPayoutOutsideWeeklySettlementCents(lines), 0);
    assert.equal(dailyDriverPayoutInWeeklySettlementCents(lines), 10_000);
  });

  it('não subtrai diária do Financeiro já zerada pelo motor', () => {
    assert.equal(dailyDriverPayoutOutsideWeeklySettlementCents([financialDailyLine(18_000)]), 0);
  });

  it('subtrai resíduo de acerto legado ainda embutido no neto', () => {
    const legacy: Line = {
      kind: 'daily',
      driver_amount_cents: 15_000,
      metadata: { allocation_rule: 'direct_pharmacy_without_group' },
    };
    assert.equal(dailyDriverPayoutOutsideWeeklySettlementCents([legacy]), 15_000);
    assert.equal(dailyDriverPayoutInWeeklySettlementCents([legacy]), 0);
  });

  it('separa as duas trilhas no mesmo acerto', () => {
    const lines = [
      { kind: 'deliveries', driver_amount_cents: 102_690 },
      dayBaseLine(10_000),
      financialDailyLine(18_000),
      { kind: 'absence', driver_amount_cents: -2_000 },
    ];
    assert.equal(dailyDriverPayoutInWeeklySettlementCents(lines), 10_000);
    assert.equal(dailyDriverPayoutOutsideWeeklySettlementCents(lines), 0);
    assert.equal(dailyDriverReferenceOnFinancialTrackCents(lines), 18_000);
  });

  it('tolera lista vazia ou nula', () => {
    assert.equal(dailyDriverPayoutOutsideWeeklySettlementCents([]), 0);
    assert.equal(dailyDriverPayoutOutsideWeeklySettlementCents(null), 0);
    assert.equal(dailyDriverPayoutInWeeklySettlementCents(undefined), 0);
  });
});

describe('dailyLineHasStaleWeeklyPayout', () => {
  it('não acusa a diária-base de escala como resíduo a recalcular', () => {
    assert.equal(dailyLineHasStaleWeeklyPayout(dayBaseLine(10_000)), false);
  });

  it('acusa diária de terça com repasse ainda na linha', () => {
    assert.equal(
      dailyLineHasStaleWeeklyPayout({
        kind: 'daily',
        driver_amount_cents: 14_000,
        metadata: { allocation_rule: 'operation_absorbed' },
      }),
      true
    );
  });

  it('não acusa diária de terça já zerada nem linha de outro tipo', () => {
    assert.equal(dailyLineHasStaleWeeklyPayout(financialDailyLine(18_000)), false);
    assert.equal(dailyLineHasStaleWeeklyPayout({ kind: 'deliveries', driver_amount_cents: 102_690 }), false);
  });
});

describe('Drogaria Agapeama — diária-base de 15/08 no PIX de quinta', () => {
  /** Reproduz o PIX de quinta como o A pagar semanal o calcula. */
  function weeklyPixCents(netDriverPayoutCents: number, lines: Line[]): number {
    return Math.max(0, netDriverPayoutCents - dailyDriverPayoutOutsideWeeklySettlementCents(lines));
  }

  const cenario = [
    { nome: 'WESLEY RICARDO DE OLIVEIRA', baseCents: 102_690, diariaCents: 10_000, esperadoCents: 112_690 },
    { nome: 'GUILHERME DA SILVA GOMES', baseCents: 62_370, diariaCents: 10_000, esperadoCents: 72_370 },
    { nome: 'EDUARDO COSTA DA SILVA', baseCents: 99_540, diariaCents: 0, esperadoCents: 99_540 },
  ];

  for (const { nome, baseCents, diariaCents, esperadoCents } of cenario) {
    it(`${nome} recebe ${esperadoCents / 100} na quinta`, () => {
      const lines: Line[] = [{ kind: 'deliveries', driver_amount_cents: baseCents }];
      if (diariaCents > 0) lines.push(dayBaseLine(diariaCents));
      // O motor já soma a diária-base em net_driver_payout_cents (driverExtras).
      const netDriverPayoutCents = baseCents + diariaCents;
      assert.equal(weeklyPixCents(netDriverPayoutCents, lines), esperadoCents);
    });
  }

  it('a farmácia continua sendo cobrada R$ 143,00 por diária, sem dobra', () => {
    const line = dayBaseLine(10_000);
    assert.equal(line.pharmacy_amount_cents, 14_300);
    assert.equal(line.driver_amount_cents, 10_000);
  });

  it('os R$ 200,00 das duas diárias deixam de ficar sem pagador', () => {
    const wesley = [{ kind: 'deliveries', driver_amount_cents: 102_690 }, dayBaseLine(10_000)];
    const guilherme = [{ kind: 'deliveries', driver_amount_cents: 62_370 }, dayBaseLine(10_000)];
    const totalNaQuinta =
      dailyDriverPayoutInWeeklySettlementCents(wesley) + dailyDriverPayoutInWeeklySettlementCents(guilherme);
    assert.equal(totalNaQuinta, 20_000);
    assert.equal(dailyDriverReferenceOnFinancialTrackCents([...wesley, ...guilherme]), 0);
  });
});
