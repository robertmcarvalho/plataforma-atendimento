import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { billingEntityLabel, billingStatusLabel } from './billingLabels';

describe('billingLabels', () => {
  it('traduz status operacionais para português', () => {
    assert.equal(billingStatusLabel('draft'), 'Rascunho');
    assert.equal(billingStatusLabel('approved'), 'Aprovado');
    assert.equal(billingStatusLabel('paid'), 'Pago');
    assert.equal(billingStatusLabel('cancelled'), 'Cancelado');
  });

  it('traduz entidades para rótulos de operador', () => {
    assert.equal(billingEntityLabel('coop'), 'CoopMob');
    assert.equal(billingEntityLabel('flux'), 'Flux Farma');
    assert.equal(billingEntityLabel('both'), 'CoopMob + Flux Farma');
  });
});
