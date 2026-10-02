import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MOTOR_CONFIG } from './commercialMotorConfigCore';
import {
  applyCenarioSelectionById,
  buildDimensionamentoInputFromLead,
  calcularDimensionamentoOperacional,
  DimensionamentoValidationError,
  type DimensionamentoInput,
} from './operationalDimensioning';

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

describe('calcularDimensionamentoOperacional', () => {
  it('cenário 1: cidade média, 20 entregas/dia, seg-sex 10-19, sáb manhã, dom fechado', () => {
    const r = calcularDimensionamentoOperacional(baseInput({ entregas_media_dia: 20 }));
    assert.equal(r.perfil_operacao, 'reduzida');
    assert.equal(r.quantidade_entregadores_recomendada, 1);
    assert.equal(r.quantidade_diarias_semana, 0);
    assert.equal(r.dias_funcionamento_semana, 6);
    assert.ok(r.receita_semanal_estimada > 0);
    assert.ok(r.proposta_textual.includes('Belo Horizonte'));
  });

  it('cenário 2: cidade média, 40 entregas/dia, horário estendido', () => {
    const r = calcularDimensionamentoOperacional(
      baseInput({
        entregas_media_dia: 40,
        horario_seg_sex_inicio: '08:00',
        horario_seg_sex_fim: '22:00',
        horario_sabado_inicio: '08:00',
        horario_sabado_fim: '18:00',
      }),
    );
    assert.equal(r.perfil_operacao, 'intermediaria');
    assert.equal(r.quantidade_entregadores_recomendada, 2);
    assert.equal(r.quantidade_diarias_semana, 2);
  });

  it('cenário 3: cidade grande, 120 entregas/dia, todos os dias', () => {
    const r = calcularDimensionamentoOperacional(
      baseInput({
        cidade: 'São Paulo',
        estado: 'SP',
        entregas_media_dia: 120,
        perfil_cidade: 'grande',
        horario_seg_sex_inicio: '08:00',
        horario_seg_sex_fim: '22:00',
        horario_domingo_inicio: '08:00',
        horario_domingo_fim: '22:00',
        delivery_funciona_domingo: true,
      }),
    );
    assert.equal(r.perfil_operacao, 'grande');
    assert.ok(r.quantidade_entregadores_recomendada >= 7);
    assert.equal(r.dias_funcionamento_semana, 7);
  });

  it('cenário 4: cidade pequena, 10 entregas/dia, horário amplo', () => {
    const r = calcularDimensionamentoOperacional(
      baseInput({
        cidade: 'Itabira',
        perfil_cidade: 'pequena',
        entregas_media_dia: 10,
        horario_seg_sex_inicio: '08:00',
        horario_seg_sex_fim: '22:00',
      }),
    );
    assert.equal(r.perfil_operacao, 'muito_baixa');
    assert.equal(r.quantidade_entregadores_recomendada, 0);
    assert.ok(r.alertas.some((a) => a.includes('horário') || a.includes('muito baixa')));
  });

  it('cenário 5: sem preço cadastrado — usa valor padrão', () => {
    const r = calcularDimensionamentoOperacional(
      baseInput({
        cidade: 'Cidade Sem Preço',
        valor_entrega_informado: undefined,
        preco_cidade: null,
      }),
    );
    assert.equal(r.valor_entrega_utilizado, DEFAULT_MOTOR_CONFIG.financeiro.valor_entrega_padrao);
    assert.ok(r.alertas.some((a) => a.includes('valor padrão')));
  });

  it('calcula valor do lead com margem 30% sobre faturamento mensal × 12', () => {
    const r = calcularDimensionamentoOperacional(baseInput({ entregas_media_dia: 30, valor_entrega_informado: 10 }));
    const faturamentoMensal = r.faturamento_mensal_farmacia ?? 0;
    const expectedLead = Math.round(faturamentoMensal * 0.3 * 12 * 100);
    assert.equal(r.valor_lead_anual_cents, expectedLead);
  });

  it('respeita preço por cidade na config', () => {
    const motor = {
      ...DEFAULT_MOTOR_CONFIG,
      precos_cidade: [{ estado: 'MG', cidade: 'Belo Horizonte', valor_entrega: 11.5 }],
    };
    const r = calcularDimensionamentoOperacional(baseInput({ motor_config: motor, preco_cidade: null }));
    assert.equal(r.valor_entrega_utilizado, 11.5);
  });

  it('cenário print: 200 entregas/mês, horário amplo 7 dias — gera cenários A e B', () => {
    const entregasDia = Math.max(1, Math.round(200 / (6 * (52 / 12))));
    const r = calcularDimensionamentoOperacional(
      baseInput({
        entregas_media_dia: entregasDia,
        entregas_media_mes: 200,
        horario_seg_sex_inicio: '08:00',
        horario_seg_sex_fim: '22:00',
        horario_sabado_inicio: '08:00',
        horario_sabado_fim: '22:00',
        horario_domingo_inicio: '08:00',
        horario_domingo_fim: '20:00',
        delivery_funciona_domingo: true,
        delivery_hours_informed: true,
        perfil_cidade: 'grande',
      }),
    );
    assert.equal(entregasDia, 8);
    assert.equal(r.cenarios_alternativos?.length, 3);
    assert.equal(r.cenario_selecionado, null);
    const enxuto = r.cenarios_alternativos!.find((c) => c.id === 'enxuto');
    const enxutoDom = r.cenarios_alternativos!.find((c) => c.id === 'enxuto_domingo');
    const integral = r.cenarios_alternativos!.find((c) => c.id === 'integral');
    assert.ok(enxuto?.recomendado);
    assert.equal(enxuto?.quantidade_entregadores_recomendada, 1);
    assert.equal(enxuto?.quantidade_diarias_semana, 0);
    assert.equal(enxuto?.faturamento_semanal_farmacia, 1000);
    assert.equal(enxutoDom?.quantidade_diarias_semana, 1);
    assert.equal(enxutoDom?.faturamento_semanal_farmacia, 1250);
    assert.equal(integral?.quantidade_entregadores_recomendada, 2);
    assert.equal(integral?.quantidade_diarias_semana, 2);
    assert.equal(integral?.faturamento_semanal_farmacia, 2500);
    assert.equal(r.quantidade_entregadores_recomendada, 1);
    assert.equal(r.classificacao_viabilidade, 'viavel');
    assert.equal(r.modelo_cobranca, 'minimo_garantido');
    assert.equal(r.faturamento_semanal_farmacia, 1000);
    const expectedLead = Math.round(1000 * (52 / 12) * 0.3 * 12 * 100);
    assert.equal(r.valor_lead_anual_cents, expectedLead);
    assert.ok(r.margem_flux_semana != null && r.margem_flux_semana > 0);
    assert.ok(enxuto!.resumo_operacional?.length);
    assert.ok(enxuto!.sugestao_comercial.includes('domingo fechado'));
    assert.equal(enxuto!.sugestao_escala.turnos.length, 0);
    assert.equal(integral!.sugestao_escala.turnos.length, 0);
    assert.ok(integral!.sugestao_comercial.includes('folgam'));
  });

  it('applyCenarioSelectionById atualiza valor do lead', () => {
    const entregasDia = Math.max(1, Math.round(200 / (6 * (52 / 12))));
    const r = calcularDimensionamentoOperacional(
      baseInput({
        entregas_media_dia: entregasDia,
        entregas_media_mes: 200,
        horario_seg_sex_inicio: '08:00',
        horario_seg_sex_fim: '22:00',
        horario_sabado_inicio: '08:00',
        horario_sabado_fim: '22:00',
        horario_domingo_inicio: '08:00',
        horario_domingo_fim: '20:00',
        delivery_funciona_domingo: true,
        delivery_hours_informed: true,
        perfil_cidade: 'grande',
      }),
    );
    assert.equal(r.cenarios_alternativos?.length, 3);
    const integral = r.cenarios_alternativos!.find((c) => c.id === 'integral')!;
    applyCenarioSelectionById(r, 'integral');
    assert.equal(r.cenario_selecionado, 'integral');
    assert.equal(r.valor_lead_anual_cents, integral.valor_lead_anual_cents);
    assert.equal(r.quantidade_entregadores_recomendada, 2);
  });
});

describe('buildDimensionamentoInputFromLead', () => {
  it('strict mode throws when operational fields missing', () => {
    assert.throws(
      () =>
        buildDimensionamentoInputFromLead(
          { city: 'BH', state: 'MG', monthly_deliveries: 100, custom_fields: {} },
          DEFAULT_MOTOR_CONFIG,
          { strict: true },
        ),
      (e: unknown) => e instanceof DimensionamentoValidationError,
    );
  });
});

describe('financeiro regional', () => {
  it('usa mínimo garantido regional para a cidade', () => {
    const motor = {
      ...DEFAULT_MOTOR_CONFIG,
      precos_cidade: [
        {
          estado: 'SP',
          cidade: 'São Paulo',
          minimo_garantido_semanal: 1400,
        },
      ],
    };
    const r = calcularDimensionamentoOperacional(
      baseInput({
        cidade: 'São Paulo',
        estado: 'SP',
        entregas_media_dia: 20,
        motor_config: motor,
      }),
    );
    assert.equal(r.custo_minimo_garantido_semana, 1400);
    assert.equal(r.financeiro_fonte, 'regional');
    assert.equal(r.financeiro_regional_key, 'SP/São Paulo');
    assert.equal(r.financeiro_aplicado?.minimo_garantido_semanal, 1400);
  });

  it('herda workspace quando regional não define mínimo garantido', () => {
    const motor = {
      ...DEFAULT_MOTOR_CONFIG,
      precos_cidade: [{ estado: 'MG', cidade: 'Belo Horizonte', valor_entrega: 11 }],
    };
    const r = calcularDimensionamentoOperacional(
      baseInput({ motor_config: motor, preco_cidade: null }),
    );
    assert.equal(r.financeiro_aplicado?.minimo_garantido_semanal, 1000);
    assert.equal(r.financeiro_fonte, 'regional');
  });

  it('lead override vence perfil regional', () => {
    const motor = {
      ...DEFAULT_MOTOR_CONFIG,
      precos_cidade: [
        { estado: 'SP', cidade: 'São Paulo', minimo_garantido_semanal: 1400 },
      ],
    };
    const input = buildDimensionamentoInputFromLead(
      {
        city: 'São Paulo',
        state: 'SP',
        monthly_deliveries: 600,
        custom_fields: {
          perfil_cidade: 'media',
          delivery_hours_informed: true,
          delivery_sabado: false,
          horario_seg_sex_inicio: '08:00',
          horario_seg_sex_fim: '18:00',
          minimo_garantido_semanal_informado: 1600,
        },
      },
      motor,
      { strict: true },
    );
    const r = calcularDimensionamentoOperacional(input);
    assert.equal(r.custo_minimo_garantido_semana, 1600);
    assert.equal(r.financeiro_fonte, 'lead_override');
  });

  it('aplica taxa de entrega informada no lead', () => {
    const motor = structuredClone(DEFAULT_MOTOR_CONFIG);
    const input = buildDimensionamentoInputFromLead(
      {
        city: 'São Paulo',
        state: 'SP',
        monthly_deliveries: 600,
        custom_fields: {
          perfil_cidade: 'media',
          delivery_hours_informed: true,
          delivery_sabado: false,
          horario_seg_sex_inicio: '08:00',
          horario_seg_sex_fim: '18:00',
          valor_entrega_informado: 9.5,
        },
      },
      motor,
      { strict: true },
    );
    const r = calcularDimensionamentoOperacional(input);
    assert.equal(r.valor_entrega_utilizado, 9.5);
    assert.equal(r.financeiro_fonte, 'lead_override');
  });
});
