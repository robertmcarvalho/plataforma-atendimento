import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveContractOnboardingStatus, sellerContractChecklist } from './contractOnboarding';

describe('resolveContractOnboardingStatus', () => {
  it('marks complete when seller checklist is complete even without lead_snapshot', () => {
    const lead = {
      legal_name: 'Farmácia X LTDA',
      trade_name: 'Farmácia X',
      address_cep: '30130000',
      address_street: 'Rua A',
      address_number: '10',
      address_neighborhood: 'Centro',
      city: 'BH',
      state: 'MG',
      custom_fields: {
        delivery_hours_informed: true,
        delivery_seg_sex: true,
        horario_seg_sex_inicio: '08:00',
        horario_seg_sex_fim: '18:00',
      },
    };
    const seller = {
      legal_name: 'Farmácia X LTDA',
      trade_name: 'Farmácia X',
      delivery_fee_cents: 500,
      delivery_fee_driver_payout_cents: 400,
      setup_cents: 10000,
      drivers_count: 2,
    };
    const check = sellerContractChecklist(seller, lead);
    assert.equal(check.complete, true);

    const status = resolveContractOnboardingStatus({ status: 'awaiting_lead', seller }, lead);
    assert.equal(status, 'complete');
  });

  it('stays awaiting_lead when seller checklist is incomplete and no submission', () => {
    const status = resolveContractOnboardingStatus({ status: 'awaiting_lead' }, { trade_name: 'X' });
    assert.equal(status, 'awaiting_lead');
  });
});
