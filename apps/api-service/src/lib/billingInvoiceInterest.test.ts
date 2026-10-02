import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildInterestLineMetadata,
  interestCentsForCredit,
  invoiceHasPreservableInterest,
  isManualInterestLine,
  validateInterestReason,
} from './billingInvoiceInterest';

describe('billingInvoiceInterest', () => {
  it('computes LBL-style credit difference as interest', () => {
    assert.equal(
      interestCentsForCredit({
        invoiceTotalCents: 283815,
        amountPaidCents: 0,
        creditCents: 283874,
      }),
      59
    );
    assert.equal(
      interestCentsForCredit({
        invoiceTotalCents: 50085,
        amountPaidCents: 0,
        creditCents: 50095,
      }),
      10
    );
  });

  it('returns 0 when credit does not exceed available balance', () => {
    assert.equal(
      interestCentsForCredit({
        invoiceTotalCents: 10000,
        amountPaidCents: 2000,
        pendingUnreconciledCents: 1000,
        creditCents: 7000,
      }),
      0
    );
  });

  it('subtracts pending baixas from available before computing interest', () => {
    assert.equal(
      interestCentsForCredit({
        invoiceTotalCents: 283815,
        amountPaidCents: 0,
        pendingUnreconciledCents: 283815,
        creditCents: 283874,
      }),
      283874
    );
  });

  it('validates reason length', () => {
    assert.ok(validateInterestReason('ab'));
    assert.equal(validateInterestReason('Diferença TED LBL'), null);
  });

  it('builds metadata with nfse_exclude and manual_adjustment', () => {
    const meta = buildInterestLineMetadata({
      reason: 'Diferença TED',
      createdBy: 'user-1',
      sourceMovementId: 'mov-1',
    });
    assert.equal(meta.kind, 'interest');
    assert.equal(meta.manual_adjustment, true);
    assert.equal(meta.nfse_exclude, true);
    assert.equal(meta.reason, 'Diferença TED');
    assert.ok(isManualInterestLine(meta));
  });

  it('detects preservable interest lines on invoice', () => {
    assert.equal(
      invoiceHasPreservableInterest([
        { metadata: { settlement_id: 'x' } },
        { metadata: { kind: 'interest', manual_adjustment: true } },
      ]),
      true
    );
    assert.equal(invoiceHasPreservableInterest([{ metadata: { kind: 'other' } }]), false);
  });
});
