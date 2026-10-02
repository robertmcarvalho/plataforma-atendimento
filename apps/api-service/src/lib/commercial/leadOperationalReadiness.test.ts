import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assessLeadOperationalReadiness } from './leadOperationalReadiness';

function completeLead(): Record<string, unknown> {
  return {
    city: 'Belo Horizonte',
    state: 'MG',
    monthly_deliveries: 1200,
    custom_fields: {
      perfil_cidade: 'media',
      delivery_hours_informed: true,
      delivery_seg_sex: true,
      horario_seg_sex_inicio: '09:00',
      horario_seg_sex_fim: '18:00',
      delivery_sabado: true,
      horario_sabado_inicio: '09:00',
      horario_sabado_fim: '13:00',
      delivery_domingo: false,
    },
  };
}

describe('assessLeadOperationalReadiness', () => {
  it('ready when operational fields are complete', () => {
    const r = assessLeadOperationalReadiness(completeLead());
    assert.equal(r.ready, true);
    assert.equal(r.missing.length, 0);
  });

  it('missing volume and hours when empty', () => {
    const r = assessLeadOperationalReadiness({
      city: 'BH',
      state: 'MG',
      custom_fields: {},
    });
    assert.equal(r.ready, false);
    assert.ok(r.missing.some((m) => m.field === 'monthly_deliveries'));
    assert.ok(r.missing.some((m) => m.field === 'custom_fields.delivery_hours_informed'));
  });

  it('requires sunday hours when delivery on sunday', () => {
    const lead = completeLead();
    (lead.custom_fields as Record<string, unknown>).delivery_domingo = true;
    const r = assessLeadOperationalReadiness(lead);
    assert.equal(r.ready, false);
    assert.ok(r.missing.some((m) => m.field.includes('domingo')));
  });
});
