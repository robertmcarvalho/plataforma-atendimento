import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEBIT_PAYABLE_HIGH_CONFIDENCE_SCORE,
  DEBIT_PAYABLE_SUGGESTION_MIN_SCORE,
  availablePayableCents,
  buildDebitPayableSuggestions,
  isPayableEligibleForDebitSuggestion,
  scoreDebitPayableSuggestion,
  textScore,
} from './billingDebitPayableSuggestions';

describe('billingDebitPayableSuggestions', () => {
  it('textScore dá inclusão total e partial tokens', () => {
    assert.equal(textScore('PIX JOAO SILVA', 'JOAO SILVA'), 30);
    assert.ok(textScore('PIX ENVIADO JOAO ENTREGADOR', 'JOAO SILVA ENTREGADOR') >= 15);
    assert.equal(textScore(null, 'JOAO'), 0);
  });

  it('exige saldo disponível exatamente igual ao valor do movimento', () => {
    const payable = {
      id: 'p1',
      description: 'Diária',
      beneficiary_name: 'João Silva',
      due_date: '2026-08-20',
      amount_cents: 150_000,
      amount_paid_cents: 0,
      status: 'approved',
      payment_blocked: false,
    };
    assert.equal(availablePayableCents(payable, 0), 150_000);
    assert.equal(isPayableEligibleForDebitSuggestion(payable, 150_000, 0), true);
    assert.equal(isPayableEligibleForDebitSuggestion(payable, 100_000, 0), false);
    assert.equal(isPayableEligibleForDebitSuggestion(payable, 150_000, 50_000), false);
    assert.equal(isPayableEligibleForDebitSuggestion({ ...payable, status: 'draft' }, 150_000, 0), false);
    assert.equal(isPayableEligibleForDebitSuggestion({ ...payable, payment_blocked: true }, 150_000, 0), false);
  });

  it('score combina data e nome alinhado ao motor de conciliação', () => {
    const score = scoreDebitPayableSuggestion(
      { movement_date: '2026-08-20', description: 'Pix enviado para JOAO SILVA' },
      { description: 'Pagamento diária', beneficiary_name: 'João Silva', due_date: '2026-08-20' }
    );
    assert.ok(score >= DEBIT_PAYABLE_HIGH_CONFIDENCE_SCORE);
    assert.ok(score <= 110);
  });

  it('buildDebitPayableSuggestions faz match guloso 1:1 com igualdade estrita', () => {
    const movements = [
      {
        id: 'm1',
        movement_date: '2026-08-20',
        amount_cents: 150_000,
        description: 'Pix enviado para JOAO SILVA',
        direction: 'debit' as const,
        reconciled: false,
      },
      {
        id: 'm2',
        movement_date: '2026-08-20',
        amount_cents: 70_000,
        description: 'Pix MARIA',
        direction: 'debit' as const,
        reconciled: false,
      },
      {
        id: 'm3',
        movement_date: '2026-08-20',
        amount_cents: 99_000,
        description: 'Pix SEM MATCH',
        direction: 'debit' as const,
        reconciled: false,
      },
    ];
    const payables = [
      {
        id: 'ap-joao',
        description: 'Diária João',
        beneficiary_name: 'João Silva',
        due_date: '2026-08-20',
        amount_cents: 150_000,
        amount_paid_cents: 0,
        status: 'approved',
        payment_blocked: false,
      },
      {
        id: 'ap-maria',
        description: 'Comissão Maria',
        beneficiary_name: 'Maria Souza',
        due_date: '2026-08-19',
        amount_cents: 70_000,
        amount_paid_cents: 0,
        status: 'approved',
        payment_blocked: false,
      },
      {
        id: 'ap-wrong-amount',
        description: 'Outro',
        beneficiary_name: 'Sem Match',
        due_date: '2026-08-20',
        amount_cents: 200_000,
        amount_paid_cents: 0,
        status: 'approved',
        payment_blocked: false,
      },
    ];

    const suggestions = buildDebitPayableSuggestions({ movements, payables });
    assert.equal(suggestions.length, 2);
    assert.equal(suggestions.find((s) => s.movement_id === 'm1')?.payable_id, 'ap-joao');
    assert.equal(suggestions.find((s) => s.movement_id === 'm2')?.payable_id, 'ap-maria');
    assert.ok((suggestions.find((s) => s.movement_id === 'm1')?.score || 0) >= DEBIT_PAYABLE_SUGGESTION_MIN_SCORE);
    assert.equal(suggestions.some((s) => s.movement_id === 'm3'), false);
  });

  it('não sugere movimento que já tem baixa pendente compatível nem AP já usado', () => {
    const movements = [
      {
        id: 'm1',
        movement_date: '2026-08-20',
        amount_cents: 50_000,
        description: 'Pix JOAO',
        direction: 'debit' as const,
        reconciled: false,
      },
      {
        id: 'm2',
        movement_date: '2026-08-20',
        amount_cents: 50_000,
        description: 'Pix JOAO 2',
        direction: 'debit' as const,
        reconciled: false,
      },
    ];
    const payables = [
      {
        id: 'ap1',
        description: 'AP João',
        beneficiary_name: 'João',
        due_date: '2026-08-20',
        amount_cents: 50_000,
        amount_paid_cents: 0,
        status: 'approved',
        payment_blocked: false,
      },
    ];
    const withSkip = buildDebitPayableSuggestions({
      movements,
      payables,
      movementIdsWithPendingPayment: ['m1'],
    });
    assert.equal(withSkip.length, 1);
    assert.equal(withSkip[0]?.movement_id, 'm2');

    const ignored = buildDebitPayableSuggestions({
      movements,
      payables,
      ignoredMovementIds: ['m2'],
    });
    assert.equal(ignored.length, 1);
    assert.equal(ignored[0]?.movement_id, 'm1');
  });

  it('marca alta confiança a partir do limiar', () => {
    const suggestions = buildDebitPayableSuggestions({
      movements: [
        {
          id: 'm1',
          movement_date: '2026-08-20',
          amount_cents: 10_000,
          description: 'Pix enviado para ANA PAULA COSTA',
          direction: 'debit',
          reconciled: false,
        },
      ],
      payables: [
        {
          id: 'ap1',
          description: 'Pagamento Ana',
          beneficiary_name: 'Ana Paula Costa',
          due_date: '2026-08-20',
          amount_cents: 10_000,
          amount_paid_cents: 0,
          status: 'approved',
          payment_blocked: false,
        },
      ],
    });
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0]?.high_confidence, true);
    assert.ok((suggestions[0]?.score || 0) >= DEBIT_PAYABLE_HIGH_CONFIDENCE_SCORE);
  });
});
