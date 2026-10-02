import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applySettlementExclusionOverlay,
  driverIsFullyExcluded,
  settlementLineFingerprint,
  type SettlementExclusion,
} from './billingSettlementExclusionOverlay';

const tania = '6bf255dd-tania';
const pharmacy = 'pense-07';

const mgLine = {
  kind: 'minimum_guarantee',
  description: 'MG proporcional (2/7 dias)',
  pharmacy_amount_cents: 32571,
  driver_amount_cents: 22857,
  metadata: {},
};

const dailyLine = {
  kind: 'daily',
  description: 'Diária contratada (1× no ciclo)',
  pharmacy_amount_cents: 28000,
  driver_amount_cents: 0,
  metadata: { allocation_rule: 'pharmacy_contracted_daily' },
};

describe('applySettlementExclusionOverlay', () => {
  it('exclui só a linha de diária e preserva MG', () => {
    const exclusions: SettlementExclusion[] = [
      {
        driverId: tania,
        pharmacyId: pharmacy,
        scope: 'line',
        lineKind: 'daily',
        lineFingerprint: settlementLineFingerprint(dailyLine),
        justification: 'teste — diária no anfitrião errado',
        pharmacyAmountCentsBefore: 28000,
        driverAmountCentsBefore: 0,
      },
    ];
    const result = applySettlementExclusionOverlay({
      driverId: tania,
      pharmacyId: pharmacy,
      lines: [mgLine, dailyLine],
      exclusions,
    });
    assert.equal(result.excluded, true);
    assert.equal(result.lines[0]!.pharmacy_amount_cents, 32571);
    assert.equal(result.lines[1]!.pharmacy_amount_cents, 0);
    assert.equal(result.lines[1]!.metadata?.billing_exclusion, true);
    assert.equal(result.lines[1]!.metadata?.pharmacy_amount_cents_before, 28000);
  });

  it('exclui o entregador inteiro (MG + diária) e o recalc reaplicaria a mesma overlay', () => {
    const exclusions: SettlementExclusion[] = [
      {
        driverId: tania,
        pharmacyId: pharmacy,
        scope: 'driver',
        lineKind: null,
        lineFingerprint: null,
        justification: 'Tânia de teste — sem vínculo nesta loja',
        pharmacyAmountCentsBefore: 60571,
        driverAmountCentsBefore: 22857,
      },
    ];
    const first = applySettlementExclusionOverlay({
      driverId: tania,
      pharmacyId: pharmacy,
      lines: [mgLine, dailyLine],
      exclusions,
    });
    const again = applySettlementExclusionOverlay({
      driverId: tania,
      pharmacyId: pharmacy,
      lines: [mgLine, dailyLine],
      exclusions,
    });
    assert.equal(driverIsFullyExcluded(exclusions, tania, pharmacy), true);
    assert.equal(first.lines.every((line) => line.pharmacy_amount_cents === 0), true);
    assert.deepEqual(
      first.lines.map((line) => line.pharmacy_amount_cents),
      again.lines.map((line) => line.pharmacy_amount_cents)
    );
  });

  it('não esvazia as linhas quando o caller reseta o array original (recalc sem exclusão)', () => {
    const source = [mgLine, dailyLine];
    const result = applySettlementExclusionOverlay({
      driverId: tania,
      pharmacyId: pharmacy,
      lines: source,
      exclusions: [],
    });
    source.length = 0;
    source.push(...result.lines);
    assert.equal(source.length, 2);
    assert.equal(source[0]!.pharmacy_amount_cents, 32571);
    assert.equal(source[1]!.pharmacy_amount_cents, 28000);
  });

  it('não mexe em outro entregador', () => {
    const exclusions: SettlementExclusion[] = [
      {
        driverId: tania,
        pharmacyId: pharmacy,
        scope: 'driver',
        lineKind: null,
        lineFingerprint: null,
        justification: 'teste',
        pharmacyAmountCentsBefore: 1,
        driverAmountCentsBefore: 0,
      },
    ];
    const result = applySettlementExclusionOverlay({
      driverId: 'eric',
      pharmacyId: pharmacy,
      lines: [dailyLine],
      exclusions,
    });
    assert.equal(result.excluded, false);
    assert.equal(result.lines[0]!.pharmacy_amount_cents, 28000);
  });
});
