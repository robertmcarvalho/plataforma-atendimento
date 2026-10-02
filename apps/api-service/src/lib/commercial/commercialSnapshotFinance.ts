import type {
  CenarioOperacionalProposta,
  DimensionamentoResultado,
  ModeloCobrancaFarmacia,
} from './operationalDimensioning';

const MARGEM_PCT = 0.3;
const SEMANAS_POR_MES = 52 / 12;

export type AjusteComercialManual = {
  campo: string;
  valor_original: number;
  valor_ajustado: number;
  motivo: string;
  ajustado_em?: string;
  ajustado_por?: string;
};

export type SetupPagamento = 'a_vista' | 'parcelado';

export type PropostaComercialSnapshot = {
  setup_cents: number;
  setup_observacao?: string | null;
  package_name?: string;
  sem_setup?: boolean;
  setup_pagamento?: SetupPagamento;
  setup_parcelas?: number;
  cenario_a_domingo_aberto?: boolean;
  valor_lead_override_cents?: number | null;
  override_motivo?: string | null;
  ajustes_manuais?: AjusteComercialManual[];
};

export function custoFarmaciaSemana(mg: number, diarias: number): number {
  return mg + diarias;
}

/** Base única para modelo MG vs por entrega e margem Flux (30%). */
export function projetarFinanceiroCenario(params: {
  entregadores: number;
  custoMinimoSemana: number;
  custoDiariasSemana: number;
  receitaTaxasSemanal: number;
}): {
  custo_farmacia_semana: number;
  modelo_cobranca: ModeloCobrancaFarmacia;
  faturamento_semanal_farmacia: number;
  faturamento_mensal_farmacia: number;
  margem_flux_semana: number;
  margem_flux_mensal: number;
  valor_lead_anual_cents: number;
} {
  const { entregadores, custoMinimoSemana, custoDiariasSemana, receitaTaxasSemanal } = params;
  const custoFarmacia = custoFarmaciaSemana(custoMinimoSemana, custoDiariasSemana);
  const usaPorEntrega =
    entregadores > 0 && receitaTaxasSemanal >= custoFarmacia && receitaTaxasSemanal > 0;
  const modelo: ModeloCobrancaFarmacia = usaPorEntrega ? 'por_entrega' : 'minimo_garantido';
  const faturamentoSemanal =
    entregadores === 0
      ? receitaTaxasSemanal
      : modelo === 'por_entrega'
        ? receitaTaxasSemanal
        : custoFarmacia > 0
          ? custoFarmacia
          : receitaTaxasSemanal;
  const faturamentoMensal = faturamentoSemanal * SEMANAS_POR_MES;
  const margemSem = faturamentoSemanal * MARGEM_PCT;
  const margemMes = faturamentoMensal * MARGEM_PCT;
  return {
    custo_farmacia_semana: custoFarmacia,
    modelo_cobranca: modelo,
    faturamento_semanal_farmacia: faturamentoSemanal,
    faturamento_mensal_farmacia: faturamentoMensal,
    margem_flux_semana: margemSem,
    margem_flux_mensal: margemMes,
    valor_lead_anual_cents: Math.round(margemMes * 12 * 100),
  };
}

export function enrichCenarioFinanceiro(
  c: CenarioOperacionalProposta,
): CenarioOperacionalProposta {
  const fin = projetarFinanceiroCenario({
    entregadores: c.quantidade_entregadores_recomendada,
    custoMinimoSemana: c.custo_minimo_garantido_semana ?? 0,
    custoDiariasSemana: c.custo_diarias_semana ?? 0,
    receitaTaxasSemanal: c.receita_semanal_estimada ?? 0,
  });
  return { ...c, ...fin };
}

/** Normaliza campos financeiros em snapshots legados ou parcialmente gravados. */
export function rehydrateOperationalSnapshot(
  snapshot: DimensionamentoResultado,
): DimensionamentoResultado {
  const next: DimensionamentoResultado = { ...snapshot };

  if (next.cenarios_alternativos?.length) {
    next.cenarios_alternativos = next.cenarios_alternativos.map((c) =>
      enrichCenarioFinanceiro(c as CenarioOperacionalProposta),
    );
    const selectedId = next.cenario_selecionado;
    if (selectedId) {
      const selected = findCenarioById(next.cenarios_alternativos, selectedId);
      if (selected) {
        applyFinanceFromCenario(next, selected);
      }
    } else {
      const recomendado =
        next.cenarios_alternativos.find((c) => c.recomendado) ?? next.cenarios_alternativos[0];
      applyPreviewFromCenario(next, recomendado);
    }
  } else {
    syncTopLevelFinance(next);
  }

  if (
    next.proposta_comercial?.valor_lead_override_cents != null &&
    next.proposta_comercial.valor_lead_override_cents > 0
  ) {
    next.valor_lead_anual_cents = next.proposta_comercial.valor_lead_override_cents;
  }

  return next;
}

function applyOperationalFromCenario(
  resultado: DimensionamentoResultado,
  c: CenarioOperacionalProposta,
  markSelected: boolean,
): void {
  const enriched = enrichCenarioFinanceiro(c);
  resultado.perfil_operacao = enriched.id === 'integral' ? 'intermediaria' : 'reduzida';
  resultado.quantidade_entregadores_recomendada = enriched.quantidade_entregadores_recomendada;
  resultado.quantidade_diarias_semana = enriched.quantidade_diarias_semana;
  resultado.horario_delivery_considerado = enriched.horario_delivery_considerado;
  resultado.sugestao_comercial = enriched.sugestao_comercial;
  resultado.sugestao_escala = enriched.sugestao_escala;
  if (markSelected) {
    resultado.cenario_selecionado = enriched.id;
    resultado.cenario_selecionado_titulo = enriched.titulo;
  }
  resultado.custo_minimo_garantido_semana = enriched.custo_minimo_garantido_semana;
  resultado.custo_diarias_semana = enriched.custo_diarias_semana;
  resultado.repasse_total_entregadores = enriched.repasse_entregadores_semana;
  resultado.modelo_cobranca = enriched.modelo_cobranca;
  resultado.faturamento_semanal_farmacia = enriched.faturamento_semanal_farmacia;
  resultado.faturamento_mensal_farmacia = enriched.faturamento_mensal_farmacia;
  resultado.margem_flux_semana = enriched.margem_flux_semana;
  resultado.margem_flux_mensal = enriched.margem_flux_mensal;
  resultado.valor_lead_anual_cents = enriched.valor_lead_anual_cents;
  resultado.receita_semanal_estimada = enriched.receita_semanal_estimada;
  resultado.classificacao_viabilidade = enriched.classificacao_viabilidade;
  resultado.custo_farmacia_semana = enriched.custo_farmacia_semana;
}

function applyFinanceFromCenario(
  resultado: DimensionamentoResultado,
  c: CenarioOperacionalProposta,
): void {
  applyOperationalFromCenario(resultado, c, true);
}

function applyPreviewFromCenario(
  resultado: DimensionamentoResultado,
  c: CenarioOperacionalProposta,
): void {
  applyOperationalFromCenario(resultado, c, false);
}

function findCenarioById(
  cenarios: CenarioOperacionalProposta[],
  id: string,
): CenarioOperacionalProposta | undefined {
  const direct = cenarios.find((c) => c.id === id);
  if (direct) return direct;
  if (id === 'enxuto') return cenarios.find((c) => c.id === 'enxuto') ?? cenarios[0];
  if (id === 'enxuto_domingo') return cenarios.find((c) => c.id === 'enxuto_domingo');
  if (id === 'integral') return cenarios.find((c) => c.id === 'integral') ?? cenarios[cenarios.length - 1];
  return undefined;
}

export function syncTopLevelFinance(resultado: DimensionamentoResultado): void {
  const fin = projetarFinanceiroCenario({
    entregadores: resultado.quantidade_entregadores_recomendada,
    custoMinimoSemana: resultado.custo_minimo_garantido_semana ?? 0,
    custoDiariasSemana: resultado.custo_diarias_semana ?? 0,
    receitaTaxasSemanal: resultado.receita_semanal_estimada ?? 0,
  });
  resultado.custo_farmacia_semana = fin.custo_farmacia_semana;
  resultado.modelo_cobranca = fin.modelo_cobranca;
  resultado.faturamento_semanal_farmacia = fin.faturamento_semanal_farmacia;
  resultado.faturamento_mensal_farmacia = fin.faturamento_mensal_farmacia;
  resultado.margem_flux_semana = fin.margem_flux_semana;
  resultado.margem_flux_mensal = fin.margem_flux_mensal;
  resultado.valor_lead_anual_cents = fin.valor_lead_anual_cents;
}

export function estruturaOperacionalLabel(entregadores: number, diarias: number): string {
  const ent = entregadores === 1 ? '1 entregador' : `${entregadores} entregadores`;
  const dia = diarias === 1 ? '1 diária' : `${diarias} diárias`;
  return `${ent} + ${dia}`;
}

export function classificacaoViabilidadeLabel(raw: string): string {
  switch (raw) {
    case 'viavel':
      return 'Viável';
    case 'viavel_com_restricoes':
      return 'Viável com restrições';
    case 'nao_viavel':
      return 'Inviável neste volume';
    default:
      return raw.replace(/_/g, ' ');
  }
}

export function modeloCobrancaLabel(modelo?: ModeloCobrancaFarmacia): string {
  if (modelo === 'por_entrega') return 'Por entrega';
  if (modelo === 'minimo_garantido') return 'Mínimo garantido';
  return '—';
}

export function margemFluxDisplay(c: {
  modelo_cobranca?: ModeloCobrancaFarmacia;
  quantidade_entregadores_recomendada?: number;
  custo_minimo_garantido_semana?: number;
  custo_diarias_semana?: number;
  custo_farmacia_semana?: number;
  receita_semanal_estimada?: number;
  margem_flux_semana?: number;
}): number {
  const fin = projetarFinanceiroCenario({
    entregadores: c.quantidade_entregadores_recomendada ?? 0,
    custoMinimoSemana: c.custo_minimo_garantido_semana ?? 0,
    custoDiariasSemana: c.custo_diarias_semana ?? 0,
    receitaTaxasSemanal: c.receita_semanal_estimada ?? 0,
  });
  return fin.margem_flux_semana;
}

export function valorLeadDisplayCents(c: {
  modelo_cobranca?: ModeloCobrancaFarmacia;
  quantidade_entregadores_recomendada?: number;
  custo_minimo_garantido_semana?: number;
  custo_diarias_semana?: number;
  custo_farmacia_semana?: number;
  receita_semanal_estimada?: number;
  valor_lead_anual_cents?: number;
}): number {
  const fin = projetarFinanceiroCenario({
    entregadores: c.quantidade_entregadores_recomendada ?? 0,
    custoMinimoSemana: c.custo_minimo_garantido_semana ?? 0,
    custoDiariasSemana: c.custo_diarias_semana ?? 0,
    receitaTaxasSemanal: c.receita_semanal_estimada ?? 0,
  });
  return fin.valor_lead_anual_cents;
}
