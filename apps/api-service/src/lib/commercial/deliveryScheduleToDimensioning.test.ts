import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deliveryScheduleFromLeadCustomFields } from './leadDeliverySchedule';
import { sellerContractChecklist } from './contractOnboarding';

describe('deliveryScheduleFromLeadCustomFields', () => {
  it('returns null when hours were not informed on lead ficha', () => {
    assert.equal(deliveryScheduleFromLeadCustomFields({}), null);
    assert.equal(
      deliveryScheduleFromLeadCustomFields({ delivery_seg_sex: true, horario_seg_sex_inicio: '08:00' }),
      null,
    );
  });

  it('maps flat lead hours to pharmacy delivery_schedule', () => {
    const schedule = deliveryScheduleFromLeadCustomFields({
      delivery_hours_informed: true,
      delivery_seg_sex: true,
      horario_seg_sex_inicio: '09:00',
      horario_seg_sex_fim: '18:00',
      delivery_sabado: true,
      horario_sabado_inicio: '09:00',
      horario_sabado_fim: '13:00',
      delivery_domingo: false,
      delivery_feriados: true,
      horario_feriados_inicio: '10:00',
      horario_feriados_fim: '16:00',
    });
    assert.ok(schedule);
    const weekly = schedule!.weekly as Record<string, { is_open: boolean; intervals: Array<{ start: string; end: string }> }>;
    assert.equal(weekly.monday.is_open, true);
    assert.deepEqual(weekly.monday.intervals[0], { start: '09:00', end: '18:00' });
    assert.equal(weekly.friday.is_open, true);
    assert.equal(weekly.saturday.is_open, true);
    assert.deepEqual(weekly.saturday.intervals[0], { start: '09:00', end: '13:00' });
    assert.equal(weekly.sunday.is_open, false);
    assert.equal(schedule!.deliver_on_holidays, true);
  });
});

describe('sellerContractChecklist delivery_schedule prefill', () => {
  it('counts lead ficha hours when seller has not saved schedule yet', () => {
    const lead = {
      legal_name: 'Farmácia X LTDA',
      trade_name: 'Farmácia X',
      custom_fields: {
        delivery_hours_informed: true,
        delivery_seg_sex: true,
        horario_seg_sex_inicio: '08:00',
        horario_seg_sex_fim: '18:00',
      },
    };
    const check = sellerContractChecklist(
      {
        legal_name: 'Farmácia X LTDA',
        trade_name: 'Farmácia X',
        delivery_fee_cents: 500,
        delivery_fee_driver_payout_cents: 400,
        setup_cents: 10000,
        drivers_count: 2,
        pickup_address_cep: '30130000',
        pickup_address_street: 'Rua A',
        pickup_address_number: '10',
        pickup_address_neighborhood: 'Centro',
        pickup_city: 'BH',
        pickup_state: 'MG',
      },
      lead,
    );
    assert.ok(!check.missing.includes('delivery_schedule'));
  });
});
