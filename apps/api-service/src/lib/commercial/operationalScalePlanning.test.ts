import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ESCALA_OPERACIONAL } from './commercialMotorConfigCore';
import { descreverDomingo, planearDoisTurnos, planearUmTurno } from './operationalScalePlanning';

describe('operationalScalePlanning', () => {
  it('dois entregadores 08-22: jornada 8h, intervalos distintos na sobreposição', () => {
    const plano = planearDoisTurnos('08:00', '22:00', DEFAULT_ESCALA_OPERACIONAL);
    assert.equal(plano.turnos.length, 2);
    const e1 = plano.turnos[0]!;
    const e2 = plano.turnos[1]!;
    assert.equal(e1.entrada, '08:00');
    assert.equal(e1.saida, '16:00');
    assert.equal(e2.entrada, '14:00');
    assert.equal(e2.saida, '22:00');
    assert.equal(e1.intervalo_inicio, '14:00');
    assert.equal(e1.intervalo_fim, '15:00');
    assert.equal(e2.intervalo_inicio, '15:00');
    assert.equal(e2.intervalo_fim, '16:00');
    assert.equal(e1.horas_em_rota, 7);
    assert.equal(e2.horas_em_rota, 7);
    assert.ok(plano.cobertura_continua);
  });

  it('um entregador em janela longa gera alerta de intervalo sem cobertura', () => {
    const plano = planearUmTurno('08:00', '22:00', DEFAULT_ESCALA_OPERACIONAL, false);
    assert.equal(plano.turnos.length, 1);
    assert.ok(plano.alertas.some((a) => a.includes('intervalo')));
  });

  it('domingo fechado com 1 entregador: texto no singular e 1 diária', () => {
    const dom = descreverDomingo({
      deliveryAberto: false,
      nEntregadores: 1,
      rotacaoMin: 3,
      folguistaQuandoFechado: true,
      diariasSemana: 1,
    });
    assert.ok(dom.turno.includes('do entregador fixo'));
    assert.ok(!dom.turno.includes('entregadores fixos'));
    assert.ok(dom.folgas.includes('1 diária de folguista'));
  });

  it('domingo aberto com 2 entregadores e 2 diárias: folguistas para folgas em dias úteis', () => {
    const dom = descreverDomingo({
      deliveryAberto: true,
      horario: '(08:00–20:00)',
      nEntregadores: 2,
      rotacaoMin: 3,
      folguistaQuandoFechado: true,
      diariasSemana: 2,
    });
    assert.ok(dom.turno.includes('plantão dominical alternado'));
    assert.ok(dom.folgas.includes('2 diárias de folguista'));
    assert.ok(dom.folgas.includes('segunda a sábado'));
    assert.ok(!dom.folgas.includes('Folga dominical alternada'));
  });
});
