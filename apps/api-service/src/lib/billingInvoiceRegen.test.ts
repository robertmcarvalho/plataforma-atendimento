import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { splitAmountCents } from '@plataforma/billing-engine';
import {
  collectInvoicePharmacyIds,
  invoiceKeysToSkip,
  settlementSplitMatchesCadastro,
} from './billingInvoiceRegen';

describe('billingInvoiceRegen', () => {
  it('inclui farmácia operacional e a de faturamento do centro de custo', () => {
    assert.deepEqual(
      collectInvoicePharmacyIds({
        operationalPharmacyId: 'op',
        billingPharmacyId: 'bill',
        invoicePharmacyIdsFromLines: ['bill', 'op'],
      }).sort(),
      ['bill', 'op']
    );
  });

  it('não pula faturas da farmácia forçada sem baixa', () => {
    const keys = invoiceKeysToSkip(
      [
        { pharmacy_id: 'elida', entity_type: 'coop', status: 'draft', amount_paid_cents: 0 },
        { pharmacy_id: 'elida', entity_type: 'flux', status: 'issued', amount_paid_cents: 0 },
        { pharmacy_id: 'other', entity_type: 'coop', status: 'draft', amount_paid_cents: 0 },
      ],
      ['elida']
    );
    assert.equal(keys.has('elida:coop'), false);
    assert.equal(keys.has('elida:flux'), false);
    assert.equal(keys.has('other:coop'), true);
  });

  it('preserva fatura paga mesmo na farmácia forçada', () => {
    const keys = invoiceKeysToSkip(
      [{ pharmacy_id: 'elida', entity_type: 'coop', status: 'paid', amount_paid_cents: 100 }],
      ['elida']
    );
    assert.equal(keys.has('elida:coop'), true);
  });

  it('detecta split congelado 50/50 vs cadastro 85/15 (caso Elida)', () => {
    const francisco = 120500;
    const rodrigo = 100500;
    const expectedFrancisco = splitAmountCents(francisco, { coopPct: 85, fluxPct: 15 });
    const expectedRodrigo = splitAmountCents(rodrigo, { coopPct: 85, fluxPct: 15 });
    assert.deepEqual(expectedFrancisco, { coopCents: 102425, fluxCents: 18075 });
    assert.deepEqual(expectedRodrigo, { coopCents: 85425, fluxCents: 15075 });
    assert.equal(
      settlementSplitMatchesCadastro({
        pharmacyChargeCents: francisco,
        coopCents: 60250,
        fluxCents: 60250,
        coopPct: 85,
        fluxPct: 15,
      }),
      false
    );
    assert.equal(
      settlementSplitMatchesCadastro({
        pharmacyChargeCents: francisco,
        coopCents: expectedFrancisco.coopCents,
        fluxCents: expectedFrancisco.fluxCents,
        coopPct: 85,
        fluxPct: 15,
      }),
      true
    );
  });
});
