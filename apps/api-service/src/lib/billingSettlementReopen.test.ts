import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isReopenableSettlementStatus,
  pharmacySettlementsReopenBlocker,
  reopenInvoiceBlocker,
  reopenPayableBlocker,
} from './billingSettlementReopen';

describe('billingSettlementReopen', () => {
  it('identifica status que podem ser estornados', () => {
    assert.equal(isReopenableSettlementStatus('approved'), true);
    assert.equal(isReopenableSettlementStatus('in_review'), true);
    assert.equal(isReopenableSettlementStatus('open'), false);
    assert.equal(isReopenableSettlementStatus('paid'), false);
  });

  it('exige ao menos um acerto aprovado ou em revisão', () => {
    assert.equal(
      pharmacySettlementsReopenBlocker([
        { status: 'open' },
        { status: 'open' },
        { status: 'open' },
      ]),
      'Não há acerto aprovado ou em revisão para estornar. Os acertos já estão abertos.'
    );
    assert.equal(
      pharmacySettlementsReopenBlocker([
        { status: 'approved' },
        { status: 'approved' },
        { status: 'in_review' },
      ]),
      null
    );
  });

  it('bloqueia farmácia com acerto pago', () => {
    assert.match(
      pharmacySettlementsReopenBlocker([{ status: 'approved' }, { status: 'paid' }]) || '',
      /pago/
    );
  });

  it('bloqueia fatura com baixa', () => {
    assert.match(
      reopenInvoiceBlocker([{ status: 'draft', amount_paid_cents: 100 }]) || '',
      /fatura com pagamento/
    );
    assert.equal(reopenInvoiceBlocker([{ status: 'draft', amount_paid_cents: 0 }]), null);
  });

  it('bloqueia AP com baixa de qualquer entregador da farmácia', () => {
    const blocker = reopenPayableBlocker(
      [
        { status: 'approved', amount_paid_cents: 0, origin_type: 'cycle_settlement', beneficiary_id: 'd1' },
        { status: 'paid', amount_paid_cents: 500, origin_type: 'cycle_settlement', beneficiary_id: 'd2' },
      ],
      ['d1', 'd2', 'd3']
    );
    assert.match(blocker || '', /A pagar com baixa/);
  });

  it('ignora AP de outro entregador quando o conjunto é filtrado', () => {
    assert.equal(
      reopenPayableBlocker(
        [{ status: 'paid', amount_paid_cents: 1, origin_type: 'cycle_settlement', beneficiary_id: 'other' }],
        ['d1']
      ),
      null
    );
  });
});
