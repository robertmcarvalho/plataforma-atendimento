import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { horariosPropostaFromInput } from './commercialOperationalCopy';

describe('horariosPropostaFromInput — feriados', () => {
  const base = {
    horario_seg_sex_inicio: '08:00',
    horario_seg_sex_fim: '18:00',
    delivery_funciona_seg_sex: true,
    delivery_funciona_sabado: true,
    horario_sabado_inicio: '08:00',
    horario_sabado_fim: '14:00',
    delivery_funciona_domingo: false,
  };

  it('usa horário explícito de feriados quando informado', () => {
    const hor = horariosPropostaFromInput(
      {
        ...base,
        delivery_funciona_feriados: true,
        horario_feriados_inicio: '10:00',
        horario_feriados_fim: '16:00',
      },
      false,
      false,
    );
    assert.equal(hor.feriados, '10:00 às 16:00');
  });

  it('marca feriados como fechado quando toggle desligado', () => {
    const hor = horariosPropostaFromInput(
      {
        ...base,
        delivery_funciona_domingo: true,
        horario_domingo_inicio: '09:00',
        horario_domingo_fim: '13:00',
        delivery_funciona_feriados: false,
      },
      false,
      false,
    );
    assert.equal(hor.feriados, 'Fechado ao delivery');
    assert.equal(hor.domingo, '09:00 às 13:00 (folguista)');
  });

  it('mantém fallback legado copiando domingo quando feriados não informado', () => {
    const hor = horariosPropostaFromInput(
      {
        ...base,
        delivery_funciona_domingo: true,
        horario_domingo_inicio: '09:00',
        horario_domingo_fim: '13:00',
      },
      false,
      false,
    );
    assert.equal(hor.feriados, '09:00 às 13:00 (folguista)');
  });
});
