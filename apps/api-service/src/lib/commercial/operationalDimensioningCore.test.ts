import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MOTOR_CONFIG } from './commercialMotorConfigCore';
import {
  calcularDiasFuncionamento,
  calcularProdutividadeCidade,
  calcularProjecaoComercial,
  cenarioDisplayShortLabel,
  DimensionamentoValidationError,
  parseHorario,
  validarDimensionamentoInput,
  type DimensionamentoInput,
} from './operationalDimensioningCore';

function baseInput(partial: Partial<DimensionamentoInput> = {}): DimensionamentoInput {
  return {
    cidade: 'Belo Horizonte',
    estado: 'MG',
    entregas_media_dia: 20,
    horario_seg_sex_inicio: '10:00',
    horario_seg_sex_fim: '19:00',
    horario_sabado_inicio: '08:00',
    horario_sabado_fim: '12:00',
    delivery_funciona_seg_sex: true,
    delivery_funciona_sabado: true,
    delivery_funciona_domingo: false,
    perfil_cidade: 'media',
    tipo_operacao: 'simulacao',
    motor_config: { ...DEFAULT_MOTOR_CONFIG },
    ...partial,
  };
}

describe('operationalDimensioningCore (pure)', () => {
  it('calcularDiasFuncionamento soma dias ativos', () => {
    assert.equal(
      calcularDiasFuncionamento({
        delivery_funciona_seg_sex: true,
        delivery_funciona_sabado: false,
        delivery_funciona_domingo: false,
      }),
      5,
    );
    assert.equal(
      calcularDiasFuncionamento({
        delivery_funciona_seg_sex: true,
        delivery_funciona_sabado: true,
        delivery_funciona_domingo: true,
      }),
      7,
    );
  });

  it('calcularProdutividadeCidade lê tabela do motor', () => {
    assert.equal(calcularProdutividadeCidade('media', DEFAULT_MOTOR_CONFIG), 25);
    assert.equal(calcularProdutividadeCidade('grande', DEFAULT_MOTOR_CONFIG), 20);
  });

  it('calcularProjecaoComercial — regime mínimo garantido', () => {
    const cfg = DEFAULT_MOTOR_CONFIG.financeiro;
    const proj = calcularProjecaoComercial({
      entregadores: 1,
      diarias: 0,
      receitaTaxasSemanal: 500,
      valorEntrega: 10,
      diasSemana: 6,
      cfg,
      margemPct: 0.3,
    });
    assert.equal(proj.modelo_cobranca, 'minimo_garantido');
    assert.equal(proj.faturamento_semanal_farmacia, cfg.minimo_garantido_semanal);
    assert.equal(proj.classificacao_viabilidade, 'viavel');
  });

  it('calcularProjecaoComercial — regime por entrega quando taxas superam MG', () => {
    const cfg = DEFAULT_MOTOR_CONFIG.financeiro;
    const mgSemanal = 2 * cfg.minimo_garantido_semanal + cfg.custo_diaria;
    const receita = mgSemanal + 500;
    const proj = calcularProjecaoComercial({
      entregadores: 2,
      diarias: 1,
      receitaTaxasSemanal: receita,
      valorEntrega: 12,
      diasSemana: 6,
      cfg,
      margemPct: 0.3,
    });
    assert.equal(proj.modelo_cobranca, 'por_entrega');
    assert.equal(proj.faturamento_semanal_farmacia, receita);
  });

  it('validarDimensionamentoInput rejeita UF inválida', () => {
    assert.throws(
      () => validarDimensionamentoInput(baseInput({ estado: 'Minas' })),
      DimensionamentoValidationError,
    );
  });

  it('parseHorario e cenarioDisplayShortLabel', () => {
    assert.equal(parseHorario('10:30'), 630);
    assert.throws(() => parseHorario('25:00'), DimensionamentoValidationError);
    assert.equal(cenarioDisplayShortLabel('enxuto'), 'Cenário A — sem domingo');
    assert.equal(cenarioDisplayShortLabel('integral'), 'Cenário B');
  });
});
