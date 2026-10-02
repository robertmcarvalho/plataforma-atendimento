import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pharmacyAcertoReopenState } from './pharmacyAcertoReopen';

describe('pharmacyAcertoReopenState', () => {
  it('esconde o botão quando todos os acertos já estão abertos', () => {
    const state = pharmacyAcertoReopenState({
      settlements: [
        { status: 'open', driver_id: 'd1' },
        { status: 'open', driver_id: 'd2' },
        { status: 'open', driver_id: 'd3' },
      ],
    });
    assert.equal(state.visible, false);
    assert.equal(state.enabled, false);
  });

  it('habilita estorno de todos os acertos aprovados da farmácia', () => {
    const state = pharmacyAcertoReopenState({
      settlements: [
        { status: 'approved', driver_id: 'd1' },
        { status: 'approved', driver_id: 'd2' },
        { status: 'in_review', driver_id: 'd3' },
      ],
    });
    assert.equal(state.visible, true);
    assert.equal(state.enabled, true);
    assert.equal(state.reopenableCount, 3);
  });

  it('desabilita quando há acerto pago, fatura com baixa ou AP com baixa', () => {
    assert.equal(
      pharmacyAcertoReopenState({
        settlements: [{ status: 'approved', driver_id: 'd1' }, { status: 'paid', driver_id: 'd2' }],
      }).enabled,
      false
    );
    assert.equal(
      pharmacyAcertoReopenState({
        settlements: [{ status: 'approved', driver_id: 'd1' }],
        invoices: [{ status: 'paid', amount_paid_cents: 10 }],
      }).enabled,
      false
    );
    assert.equal(
      pharmacyAcertoReopenState({
        settlements: [{ status: 'approved', driver_id: 'd1' }],
        payables: [
          {
            beneficiary_id: 'd1',
            origin_type: 'cycle_settlement',
            status: 'paid',
            amount_paid_cents: 1,
          },
        ],
      }).enabled,
      false
    );
  });
});
