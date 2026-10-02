import type { CenarioOperacionalProposta, OperationalDimensioningResult } from '@/lib/commercial/types';

const MARGEM_PCT = 0.3;
const SEMANAS_POR_MES = 52 / 12;

export type CenarioOperacionalId = 'enxuto' | 'enxuto_domingo' | 'integral';

export function cenarioShortLabel(id: CenarioOperacionalId): string {
  if (id === 'enxuto') return 'A — sem domingo';
  if (id === 'enxuto_domingo') return 'A — com domingo';
  return 'B — integral';
}

export function custoFarmaciaSemana(mg: number, diarias: number): number {
  return mg + diarias;
}

type FinanceInput = {
  quantidade_entregadores_recomendada?: number;
  custo_minimo_garantido_semana?: number;
  custo_diarias_semana?: number;
  receita_semanal_estimada?: number;
  modelo_cobranca?: string;
  custo_farmacia_semana?: number;
  margem_flux_semana?: number;
  valor_lead_anual_cents?: number;
};

/** Espelha o motor backend: MG quando taxas < custo operacional. */
export function resolveModeloCobranca(c: FinanceInput): 'minimo_garantido' | 'por_entrega' {
  const entregadores = c.quantidade_entregadores_recomendada ?? 0;
  const receita = c.receita_semanal_estimada ?? 0;
  const custoFarmacia = custoFarmaciaFromSnapshot(c);
  if (entregadores === 0) return receita > 0 ? 'por_entrega' : 'minimo_garantido';
  if (entregadores > 0 && receita >= custoFarmacia && receita > 0) return 'por_entrega';
  return 'minimo_garantido';
}

export function isMinimoGarantido(modelo?: string): boolean {
  return modelo !== 'por_entrega';
}

/** Custo farmácia = MG + diárias. Ignora `custo_farmacia_semana` legado (podia incluir taxas). */
export function custoFarmaciaFromSnapshot(d: {
  custo_farmacia_semana?: number;
  custo_minimo_garantido_semana?: number;
  custo_diarias_semana?: number;
}): number {
  const fromParts = custoFarmaciaSemana(
    d.custo_minimo_garantido_semana ?? 0,
    d.custo_diarias_semana ?? 0,
  );
  if (fromParts > 0) return fromParts;
  return d.custo_farmacia_semana ?? 0;
}

/** Projeção financeira para exibição — alinhada a `projetarFinanceiroCenario` no backend. */
export function projetarFinanceiroDisplay(c: FinanceInput) {
  const entregadores = c.quantidade_entregadores_recomendada ?? 0;
  const receita = c.receita_semanal_estimada ?? 0;
  const custoFarmacia = custoFarmaciaFromSnapshot(c);
  const modelo = resolveModeloCobranca(c);
  const faturamentoSemanal =
    entregadores === 0
      ? receita
      : modelo === 'por_entrega'
        ? receita
        : custoFarmacia > 0
          ? custoFarmacia
          : receita;
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

/** Margem Flux exibida: em MG = 30% do custo farmácia; em por entrega = 30% das taxas. */
export function margemFluxDisplay(c: FinanceInput): number {
  return projetarFinanceiroDisplay(c).margem_flux_semana;
}

export function valorLeadDisplayCents(c: FinanceInput): number {
  return projetarFinanceiroDisplay(c).valor_lead_anual_cents;
}

function findCenarioById(
  cenarios: CenarioOperacionalProposta[],
  id: CenarioOperacionalId,
): CenarioOperacionalProposta | undefined {
  const direct = cenarios.find((c) => c.id === id);
  if (direct) return direct;
  if (id === 'enxuto') return cenarios.find((c) => c.id === 'enxuto') ?? cenarios[0];
  if (id === 'enxuto_domingo') return cenarios.find((c) => c.id === 'enxuto_domingo');
  if (id === 'integral') return cenarios.find((c) => c.id === 'integral') ?? cenarios[cenarios.length - 1];
  return undefined;
}

/** Copia dados operacionais/financeiros do cenário A ou B para o snapshot de exibição. */
export function applyCenarioSelectionDisplay(
  d: OperationalDimensioningResult,
  cenarioId: CenarioOperacionalId,
): OperationalDimensioningResult {
  if (!d.cenarios_alternativos?.length) {
    return { ...d, cenario_selecionado: cenarioId };
  }
  const selected = findCenarioById(d.cenarios_alternativos, cenarioId);
  if (!selected) {
    return { ...d, cenario_selecionado: cenarioId };
  }
  return {
    ...d,
    cenario_selecionado: cenarioId,
    cenario_selecionado_titulo: selected.titulo,
    quantidade_entregadores_recomendada: selected.quantidade_entregadores_recomendada,
    quantidade_diarias_semana: selected.quantidade_diarias_semana,
    horario_delivery_considerado: selected.horario_delivery_considerado,
    custo_minimo_garantido_semana: selected.custo_minimo_garantido_semana,
    custo_diarias_semana: selected.custo_diarias_semana,
    repasse_total_entregadores: selected.repasse_entregadores_semana,
    margem_bruta_estimada: selected.margem_bruta_estimada,
    resultado_operacional: selected.resultado_operacional,
    sugestao_comercial: selected.sugestao_comercial,
    sugestao_escala: selected.sugestao_escala,
    classificacao_viabilidade: selected.classificacao_viabilidade,
  };
}

function applySelectedCenario(
  d: OperationalDimensioningResult,
  forcedId?: CenarioOperacionalId | null,
): OperationalDimensioningResult {
  const selectedId = forcedId ?? d.cenario_selecionado;
  if (!selectedId || !d.cenarios_alternativos?.length) return d;
  return applyCenarioSelectionDisplay(d, selectedId);
}

export function normalizeDimensionamentoDisplay(
  d: OperationalDimensioningResult,
  options?: { cenarioId?: CenarioOperacionalId },
): OperationalDimensioningResult {
  const base = applySelectedCenario(d, options?.cenarioId);
  const receita = base.receita_semanal_estimada;

  const cenarios = base.cenarios_alternativos?.map((c) => ({
    ...c,
    ...projetarFinanceiroDisplay({
      ...c,
      receita_semanal_estimada: c.receita_semanal_estimada ?? receita,
    }),
  }));

  const fin = projetarFinanceiroDisplay({
    quantidade_entregadores_recomendada: base.quantidade_entregadores_recomendada,
    custo_minimo_garantido_semana: base.custo_minimo_garantido_semana,
    custo_diarias_semana: base.custo_diarias_semana,
    receita_semanal_estimada: receita,
  });

  return {
    ...base,
    ...fin,
    valor_lead_anual_cents:
      base.proposta_comercial?.valor_lead_override_cents ?? fin.valor_lead_anual_cents,
    cenarios_alternativos: cenarios,
  };
}

export type { CenarioOperacionalProposta };
