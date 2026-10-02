import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeSharedPoolDeliverySettlement } from '../../../packages/billing-engine/src/settlement.ts';

const CYCLE_DAYS = 7;

const base = {
  mgEnabled: true,
  minimumDeliveriesCount: 5,
  minimumGuaranteedCents: 120000,
  minimumGuaranteedDriverPayoutCents: 90000,
  deliveryFeeCents: 1500,
  deliveryFeeDriverPayoutCents: 1200,
  deliveryCount: 0,
};

function pool(input: Parameters<typeof computeSharedPoolDeliverySettlement>[0]) {
  const result = computeSharedPoolDeliverySettlement(input);
  const pharmacySum = result.perDriver.reduce((a, d) => a + d.pharmacyChargeCents, 0);
  const driverSum = result.perDriver.reduce((a, d) => a + d.driverPayoutCents, 0);
  // Rateio não pode criar/perder centavo em relação ao pool: conciliação da fatura.
  assert.equal(pharmacySum, result.pharmacyChargeCents);
  assert.equal(driverSum, result.totalDriverPayoutCents);
  for (const row of result.perDriver) {
    assert.ok(Number.isInteger(row.pharmacyChargeCents), 'cobrança em centavos inteiros');
    assert.ok(Number.isInteger(row.driverPayoutCents), 'repasse em centavos inteiros');
  }
  return result;
}

function share(
  result: { perDriver: Array<{ driverId: string; pharmacyChargeCents: number; driverPayoutCents: number }> },
  driverId: string
) {
  const row = result.perDriver.find((d) => d.driverId === driverId);
  if (!row) throw new Error(`driver ${driverId} ausente no pool`);
  return row;
}

describe('MG shared_pool — ciclo completo (regressão)', () => {
  it('mantém divisão igualitária quando todos cumpriram o ciclo inteiro', () => {
    const withDays = pool({
      ...base,
      splitRule: 'equal',
      totalCycleDays: CYCLE_DAYS,
      driverCounts: [
        { driverId: 'a', deliveryCount: 2, activeDays: 7 },
        { driverId: 'b', deliveryCount: 2, activeDays: 7 },
      ],
    });
    const legacy = pool({
      ...base,
      splitRule: 'equal',
      driverCounts: [
        { driverId: 'a', deliveryCount: 2 },
        { driverId: 'b', deliveryCount: 2 },
      ],
    });
    assert.equal(withDays.appliedMinimumGuarantee, true);
    assert.equal(withDays.poolProrated, false);
    assert.equal(withDays.pharmacyChargeCents, 120000);
    assert.equal(withDays.totalDriverPayoutCents, 90000);
    assert.deepEqual(withDays.perDriver, legacy.perDriver);
    assert.equal(share(withDays, 'a').pharmacyChargeCents, 60000);
    assert.equal(share(withDays, 'a').driverPayoutCents, 45000);
  });

  it('mantém rateio por entregas quando todos cumpriram o ciclo inteiro', () => {
    const result = pool({
      ...base,
      splitRule: 'by_deliveries',
      totalCycleDays: CYCLE_DAYS,
      driverCounts: [
        { driverId: 'a', deliveryCount: 3, activeDays: 7 },
        { driverId: 'b', deliveryCount: 1, activeDays: 7 },
      ],
    });
    assert.equal(result.poolProrated, false);
    assert.equal(result.pharmacyChargeCents, 120000);
    assert.equal(share(result, 'a').pharmacyChargeCents, 90000);
    assert.equal(share(result, 'b').pharmacyChargeCents, 30000);
  });

  it('não muda quando um fixo do ciclo inteiro não tem entrega', () => {
    const result = pool({
      ...base,
      splitRule: 'equal',
      totalCycleDays: CYCLE_DAYS,
      driverCounts: [
        { driverId: 'a', deliveryCount: 2, activeDays: 7 },
        { driverId: 'sem-entrega', deliveryCount: 0, activeDays: 7 },
      ],
    });
    assert.equal(result.pharmacyChargeCents, 120000);
    assert.equal(share(result, 'a').pharmacyChargeCents, 120000);
    assert.equal(share(result, 'sem-entrega').pharmacyChargeCents, 0);
    assert.equal(share(result, 'sem-entrega').driverPayoutCents, 0);
  });
});

describe('MG shared_pool — entrada e saída no meio do ciclo', () => {
  it('entrante recebe fatia proporcional aos dias vigentes', () => {
    const result = pool({
      ...base,
      splitRule: 'equal',
      totalCycleDays: CYCLE_DAYS,
      driverCounts: [
        { driverId: 'fixo', deliveryCount: 2, activeDays: 7 },
        { driverId: 'entrante', deliveryCount: 1, activeDays: 3 },
      ],
    });
    // Cobertura do ciclo é integral (o fixo cobre todos os dias): pool segue 1× MG.
    assert.equal(result.pharmacyChargeCents, 120000);
    assert.equal(result.totalDriverPayoutCents, 90000);
    assert.equal(result.poolProrated, false);
    assert.equal(share(result, 'fixo').pharmacyChargeCents, 84000);
    assert.equal(share(result, 'entrante').pharmacyChargeCents, 36000);
    assert.equal(share(result, 'fixo').driverPayoutCents, 63000);
    assert.equal(share(result, 'entrante').driverPayoutCents, 27000);
  });

  it('quem sai no meio do ciclo leva só a fatia dos dias trabalhados', () => {
    const result = pool({
      ...base,
      splitRule: 'equal',
      totalCycleDays: CYCLE_DAYS,
      driverCounts: [
        { driverId: 'desligado', deliveryCount: 1, activeDays: 3 },
        { driverId: 'fixo', deliveryCount: 2, activeDays: 7 },
      ],
    });
    assert.equal(result.pharmacyChargeCents, 120000);
    assert.equal(share(result, 'desligado').pharmacyChargeCents, 36000);
    assert.equal(share(result, 'fixo').pharmacyChargeCents, 84000);
    assert.equal(share(result, 'desligado').driverPayoutCents, 27000);
    assert.equal(share(result, 'fixo').driverPayoutCents, 63000);
  });

  it('substituição sem lacuna mantém a farmácia pagando 1× MG', () => {
    const result = pool({
      ...base,
      splitRule: 'equal',
      totalCycleDays: CYCLE_DAYS,
      driverCounts: [
        { driverId: 'saiu', deliveryCount: 1, activeDays: 3 },
        { driverId: 'entrou', deliveryCount: 1, activeDays: 4 },
      ],
    });
    assert.equal(result.poolProrated, false);
    assert.equal(result.pharmacyChargeCents, 120000);
    assert.equal(share(result, 'saiu').pharmacyChargeCents, 51429);
    assert.equal(share(result, 'entrou').pharmacyChargeCents, 68571);
  });
});

describe('MG shared_pool — cobertura parcial do ciclo', () => {
  it('participante único parcial recebe o mesmo que no MG per_driver', () => {
    const result = pool({
      ...base,
      splitRule: 'equal',
      totalCycleDays: CYCLE_DAYS,
      driverCounts: [{ driverId: 'unico', deliveryCount: 2, activeDays: 3 }],
    });
    assert.equal(result.poolProrated, true);
    // prorateCents(120000, 3, 7) e prorateCents(90000, 3, 7) do ramo per_driver.
    assert.equal(result.pharmacyChargeCents, 51429);
    assert.equal(result.totalDriverPayoutCents, 38571);
    assert.equal(share(result, 'unico').pharmacyChargeCents, 51429);
    assert.equal(share(result, 'unico').driverPayoutCents, 38571);
  });

  it('reduz o pool quando a soma dos dias vigentes não cobre o ciclo', () => {
    const result = pool({
      ...base,
      splitRule: 'equal',
      totalCycleDays: CYCLE_DAYS,
      driverCounts: [
        { driverId: 'a', deliveryCount: 1, activeDays: 2 },
        { driverId: 'b', deliveryCount: 1, activeDays: 3 },
      ],
    });
    assert.equal(result.poolProrated, true);
    assert.equal(result.pharmacyChargeCents, 85714);
    assert.equal(result.totalDriverPayoutCents, 64286);
    assert.equal(share(result, 'a').pharmacyChargeCents, 34286);
    assert.equal(share(result, 'b').pharmacyChargeCents, 51428);
  });

  it('proporcionaliza os dois lados, preservando a margem do pool', () => {
    const result = pool({
      ...base,
      splitRule: 'by_deliveries',
      totalCycleDays: CYCLE_DAYS,
      driverCounts: [{ driverId: 'unico', deliveryCount: 2, activeDays: 4 }],
    });
    const margemCheia = (120000 - 90000) / 120000;
    const margemPool = (result.pharmacyChargeCents - result.totalDriverPayoutCents) / result.pharmacyChargeCents;
    assert.ok(Math.abs(margemPool - margemCheia) < 0.0001, `margem ${margemPool} ≠ ${margemCheia}`);
  });
});

describe('MG shared_pool — bordas de dias', () => {
  it('sem dias do ciclo informados cai no comportamento igualitário', () => {
    const result = pool({
      ...base,
      splitRule: 'equal',
      totalCycleDays: 0,
      driverCounts: [
        { driverId: 'a', deliveryCount: 1, activeDays: 0 },
        { driverId: 'b', deliveryCount: 1, activeDays: 0 },
      ],
    });
    assert.equal(result.poolProrated, false);
    assert.equal(result.pharmacyChargeCents, 120000);
    assert.equal(share(result, 'a').pharmacyChargeCents, 60000);
    assert.equal(share(result, 'b').pharmacyChargeCents, 60000);
  });

  it('dias vigentes zerados não zeram nem quebram o pool', () => {
    const result = pool({
      ...base,
      splitRule: 'equal',
      totalCycleDays: CYCLE_DAYS,
      driverCounts: [
        { driverId: 'a', deliveryCount: 1, activeDays: 0 },
        { driverId: 'b', deliveryCount: 1, activeDays: null },
      ],
    });
    assert.equal(result.poolActiveDays, 0);
    assert.equal(result.poolProrated, false);
    assert.equal(result.pharmacyChargeCents, 120000);
    assert.equal(share(result, 'a').pharmacyChargeCents, 60000);
    assert.equal(share(result, 'b').pharmacyChargeCents, 60000);
  });

  it('participante com zero dias vigentes não leva fatia do pool', () => {
    const result = pool({
      ...base,
      splitRule: 'equal',
      totalCycleDays: CYCLE_DAYS,
      driverCounts: [
        { driverId: 'zero-dias', deliveryCount: 1, activeDays: 0 },
        { driverId: 'fixo', deliveryCount: 1, activeDays: 7 },
      ],
    });
    assert.equal(result.pharmacyChargeCents, 120000);
    assert.equal(share(result, 'zero-dias').pharmacyChargeCents, 0);
    assert.equal(share(result, 'fixo').pharmacyChargeCents, 120000);
  });

  it('acima do limiar segue por entrega, sem proporcional de MG', () => {
    const result = pool({
      ...base,
      splitRule: 'equal',
      totalCycleDays: CYCLE_DAYS,
      driverCounts: [
        { driverId: 'a', deliveryCount: 4, activeDays: 3 },
        { driverId: 'b', deliveryCount: 4, activeDays: 7 },
      ],
    });
    assert.equal(result.appliedMinimumGuarantee, false);
    assert.equal(result.poolProrated, false);
    assert.equal(share(result, 'a').pharmacyChargeCents, 4 * 1500);
    assert.equal(share(result, 'a').driverPayoutCents, 4 * 1200);
  });
});
