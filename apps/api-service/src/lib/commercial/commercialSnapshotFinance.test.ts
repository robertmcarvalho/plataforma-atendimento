import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  custoFarmaciaSemana,
  enrichCenarioFinanceiro,
  estruturaOperacionalLabel,
  rehydrateOperationalSnapshot,
} from './commercialSnapshotFinance';
import type { CenarioOperacionalProposta, DimensionamentoResultado } from './operationalDimensioning';

function baseSnapshot(partial: Partial<DimensionamentoResultado> = {}): DimensionamentoResultado {
  return {
    perfil_operacao: 'intermediaria',
    cidade: 'BH',
    estado: 'MG',
    valor_entrega_utilizado: 8.5,
    entregas_media_dia: 8,
    entregas_media_mes: 200,
    dias_funcionamento_semana: 6,
    horario_delivery_considerado: 'Seg–Sex 10:00–19:00',
    quantidade_entregadores_recomendada: 2,
    quantidade_diarias_semana: 2,
    custo_diarias_semana: 500,
    custo_minimo_garantido_semana: 2000,
    repasse_total_entregadores: 1400,
    receita_semanal_estimada: 476,
    margem_bruta_estimada: 0,
    resultado_operacional: 0,
    ponto_equilibrio_entregas_semana: 147,
    ponto_equilibrio_entregas_dia: 21,
    classificacao_viabilidade: 'viavel',
    receita_anual_estimada: 0,
    valor_lead_anual_cents: 0,
    alertas: [],
    sugestao_escala: { resumo: '', turnos: [], folgas: '', horario_sugerido: {} },
    sugestao_comercial: '',
    proposta_textual: '',
    ...partial,
  };
}

function baseCenario(partial: Partial<CenarioOperacionalProposta> = {}): CenarioOperacionalProposta {
  return {
    id: 'enxuto',
    titulo: 'Cenário A',
    recomendado: true,
    quantidade_entregadores_recomendada: 1,
    quantidade_diarias_semana: 1,
    horario_delivery_considerado: 'Seg–Sex 10:00–19:00',
    sugestao_comercial: 'teste',
    sugestao_escala: { resumo: 'r', turnos: ['t1'], folgas: 'f', horario_sugerido: {} },
    custo_minimo_garantido_semana: 1000,
    custo_diarias_semana: 250,
    repasse_entregadores_semana: 700,
    margem_flux_semana: 0,
    margem_flux_mensal: 0,
    modelo_cobranca: 'por_entrega',
    faturamento_semanal_farmacia: 0,
    faturamento_mensal_farmacia: 0,
    valor_lead_anual_cents: 0,
    receita_semanal_estimada: 476,
    margem_bruta_estimada: 0,
    resultado_operacional: 0,
    classificacao_viabilidade: 'viavel',
    ponto_equilibrio_entregas_semana: 147,
    ponto_equilibrio_entregas_dia: 21,
    custo_farmacia_semana: 0,
    ...partial,
  };
}

describe('commercialSnapshotFinance', () => {
  it('custoFarmaciaSemana soma MG + diárias', () => {
    assert.equal(custoFarmaciaSemana(1000, 250), 1250);
  });

  it('enrichCenarioFinanceiro corrige faturamento zero para MG', () => {
    const c = enrichCenarioFinanceiro(baseCenario());
    assert.equal(c.custo_farmacia_semana, 1250);
    assert.equal(c.modelo_cobranca, 'minimo_garantido');
    assert.equal(c.faturamento_semanal_farmacia, 1250);
    assert.equal(c.margem_flux_semana, 375);
  });

  it('estruturaOperacionalLabel formata entregadores e diárias', () => {
    assert.equal(estruturaOperacionalLabel(1, 1), '1 entregador + 1 diária');
    assert.equal(estruturaOperacionalLabel(2, 2), '2 entregadores + 2 diárias');
  });

  it('enrichCenarioFinanceiro corrige snapshot legado com custo_farmacia inflado', () => {
    const c = enrichCenarioFinanceiro(
      baseCenario({
        custo_farmacia_semana: 1726,
        faturamento_semanal_farmacia: 1726,
        margem_flux_semana: 517.8,
        modelo_cobranca: 'por_entrega',
      }),
    );
    assert.equal(c.custo_farmacia_semana, 1250);
    assert.equal(c.modelo_cobranca, 'minimo_garantido');
    assert.equal(c.margem_flux_semana, 375);
  });

  it('rehydrateOperationalSnapshot sem seleção usa preview do recomendado', () => {
    const enxuto = enrichCenarioFinanceiro(baseCenario({ id: 'enxuto' }));
    const integral = enrichCenarioFinanceiro(
      baseCenario({
        id: 'integral',
        quantidade_entregadores_recomendada: 2,
        custo_minimo_garantido_semana: 2000,
        custo_diarias_semana: 500,
      }),
    );
    const snap = rehydrateOperationalSnapshot(
      baseSnapshot({
        cenarios_alternativos: [enxuto, integral],
        cenario_selecionado: null,
      }),
    );
    assert.equal(snap.cenario_selecionado, null);
    assert.equal(snap.quantidade_entregadores_recomendada, 1);
    assert.equal(snap.custo_farmacia_semana, 1250);
  });

  it('rehydrateOperationalSnapshot aplica cenário selecionado', () => {
    const enxuto = enrichCenarioFinanceiro(baseCenario({ id: 'enxuto', valor_lead_anual_cents: 1950000 }));
    const integral = enrichCenarioFinanceiro(
      baseCenario({
        id: 'integral',
        quantidade_entregadores_recomendada: 2,
        quantidade_diarias_semana: 2,
        custo_minimo_garantido_semana: 2000,
        custo_diarias_semana: 500,
        valor_lead_anual_cents: 3900000,
      }),
    );
    const snap = rehydrateOperationalSnapshot(
      baseSnapshot({
        perfil_operacao: 'reduzida',
        quantidade_entregadores_recomendada: 1,
        quantidade_diarias_semana: 1,
        custo_minimo_garantido_semana: 1000,
        custo_diarias_semana: 250,
        repasse_total_entregadores: 700,
        cenarios_alternativos: [enxuto, integral],
        cenario_selecionado: 'integral',
      }),
    );
    assert.equal(snap.quantidade_entregadores_recomendada, 2);
    assert.equal(snap.custo_farmacia_semana, 2500);
    assert.equal(snap.valor_lead_anual_cents, 3900000);
  });
});
