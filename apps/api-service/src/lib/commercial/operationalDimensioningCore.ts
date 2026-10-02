/**
 * Motor de dimensionamento operacional — funções puras (sem I/O de rede ou banco).
 * Testável de forma independente; ver operationalDimensioningCore.test.ts.
 */

import {
  DEFAULT_ESCALA_OPERACIONAL,
  DEFAULT_MOTOR_CONFIG,
  lookupConfiguredCityPrice,
  resolveFinanceiroParaLead,
  type CidadePerfil,
  type CommercialMotorConfig,
  type ConfiguracoesGlobais,
  type FinanceiroFonte,
} from './commercialMotorConfigCore';
import type { PropostaComercialSnapshot } from './commercialSnapshotFinance';
import { enrichCenarioFinanceiro, rehydrateOperationalSnapshot } from './commercialSnapshotFinance';
import {
  ESCALA_VAZIA,
  formatHorarioDisplay,
  horariosPropostaFromInput,
  resumoOperacionalEnxuto,
  resumoOperacionalIntegral,
  sugestaoComercialEnxuto,
  sugestaoComercialIntegral,
  textoEscalaResumida,
  textoFolguista,
} from './commercialOperationalCopy';
import { montarSugestaoEscalaTexto } from './operationalScalePlanning';

export type { CidadePerfil, CommercialMotorConfig, ConfiguracoesGlobais };
export { DEFAULT_MOTOR_CONFIG };
export type TipoOperacao = 'nova' | 'existente' | 'simulacao';
export type PerfilOperacao =
  | 'muito_baixa'
  | 'reduzida'
  | 'intermediaria'
  | 'padrao'
  | 'grande';
export type ClassificacaoViabilidade = 'viavel' | 'viavel_com_restricoes' | 'nao_viavel';

export interface DimensionamentoInput {
  cidade: string;
  estado: string;
  entregas_media_dia: number;
  entregas_media_mes?: number;
  valor_entrega_informado?: number;
  horario_seg_sex_inicio: string;
  horario_seg_sex_fim: string;
  horario_sabado_inicio?: string;
  horario_sabado_fim?: string;
  horario_domingo_inicio?: string;
  horario_domingo_fim?: string;
  delivery_funciona_seg_sex: boolean;
  delivery_funciona_sabado: boolean;
  delivery_funciona_domingo: boolean;
  distancia_media_km?: number;
  perfil_cidade: CidadePerfil;
  tipo_operacao: TipoOperacao;
  motor_config: CommercialMotorConfig;
  /** Preço por entrega resolvido externamente (farmácias / override). */
  preco_cidade?: number | null;
  /** Horários informados pelo consultor na ficha (não defaults do motor). */
  delivery_hours_informed?: boolean;
  /** Financeiro resolvido (regional / lead override). */
  financeiro_resolvido?: ConfiguracoesGlobais;
  financeiro_fonte?: FinanceiroFonte;
  financeiro_regional_key?: string;
  /** Custom fields do lead para override financeiro. */
  lead_custom_fields?: Record<string, unknown>;
}

export interface SugestaoEscala {
  resumo: string;
  turnos: string[];
  folgas: string;
  horario_sugerido: Record<string, string>;
}

export interface DimensionamentoResultado {
  perfil_operacao: PerfilOperacao;
  cidade: string;
  estado: string;
  valor_entrega_utilizado: number;
  entregas_media_dia: number;
  entregas_media_mes: number;
  dias_funcionamento_semana: number;
  horario_delivery_considerado: string;
  quantidade_entregadores_recomendada: number;
  quantidade_diarias_semana: number;
  custo_diarias_semana: number;
  custo_minimo_garantido_semana: number;
  repasse_total_entregadores: number;
  receita_semanal_estimada: number;
  margem_bruta_estimada: number;
  resultado_operacional: number;
  ponto_equilibrio_entregas_semana: number;
  ponto_equilibrio_entregas_dia: number;
  classificacao_viabilidade: ClassificacaoViabilidade;
  receita_anual_estimada: number;
  valor_lead_anual_cents: number;
  alertas: string[];
  sugestao_escala: SugestaoEscala;
  sugestao_comercial: string;
  proposta_textual: string;
  /** Cenários A (horário reduzido) e B (horário integral), quando aplicável. */
  cenarios_alternativos?: CenarioOperacionalProposta[];
  /** Margem Flux semanal (30% do faturamento da farmácia). */
  margem_flux_semana?: number;
  margem_flux_mensal?: number;
  /** Modelo de cobrança à farmácia. */
  modelo_cobranca?: ModeloCobrancaFarmacia;
  /** Faturamento semanal/mensal cobrado da farmácia (MG+diárias ou taxas por entrega). */
  faturamento_semanal_farmacia?: number;
  faturamento_mensal_farmacia?: number;
  /** MG + diárias — custo total semanal à farmácia. */
  custo_farmacia_semana?: number;
  /** Setup, overrides e metadados da proposta comercial. */
  proposta_comercial?: PropostaComercialSnapshot;
  /** Cenário escolhido pelo vendedor para proposta (quando há alternativas). */
  cenario_selecionado?: CenarioOperacionalId | null;
  cenario_selecionado_titulo?: string;
  financeiro_aplicado?: {
    minimo_garantido_semanal: number;
    repasse_entregador_semanal: number;
    custo_diaria: number;
    margem_minima_semanal: number;
    valor_entrega_padrao: number;
  };
  financeiro_fonte?: FinanceiroFonte;
  financeiro_regional_key?: string;
}

export type ModeloCobrancaFarmacia = 'minimo_garantido' | 'por_entrega';

export type CenarioOperacionalId = 'enxuto' | 'enxuto_domingo' | 'integral';

export function cenarioDisplayShortLabel(id: CenarioOperacionalId): string {
  if (id === 'enxuto') return 'Cenário A — sem domingo';
  if (id === 'enxuto_domingo') return 'Cenário A — com domingo';
  return 'Cenário B';
}

export interface CenarioOperacionalProposta {
  id: CenarioOperacionalId;
  titulo: string;
  recomendado: boolean;
  quantidade_entregadores_recomendada: number;
  quantidade_diarias_semana: number;
  horario_delivery_considerado: string;
  sugestao_comercial: string;
  sugestao_escala: SugestaoEscala;
  resumo_operacional?: string[];
  custo_minimo_garantido_semana: number;
  custo_diarias_semana: number;
  repasse_entregadores_semana: number;
  margem_flux_semana: number;
  margem_flux_mensal: number;
  modelo_cobranca: ModeloCobrancaFarmacia;
  faturamento_semanal_farmacia: number;
  faturamento_mensal_farmacia: number;
  valor_lead_anual_cents: number;
  receita_semanal_estimada: number;
  custo_farmacia_semana: number;
  margem_bruta_estimada: number;
  resultado_operacional: number;
  classificacao_viabilidade: ClassificacaoViabilidade;
  ponto_equilibrio_entregas_semana: number;
  ponto_equilibrio_entregas_dia: number;
}

export class DimensionamentoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DimensionamentoValidationError';
  }
}

function financeiro(input: DimensionamentoInput): ConfiguracoesGlobais {
  return (
    input.financeiro_resolvido ?? input.motor_config.financeiro
  );
}

function ensureFinanceiroResolved(input: DimensionamentoInput): DimensionamentoInput {
  if (input.financeiro_resolvido) return input;
  const { financeiro, meta } = resolveFinanceiroParaLead({
    motor: input.motor_config,
    cidade: input.cidade,
    estado: input.estado,
    leadCustomFields: input.lead_custom_fields,
  });
  return {
    ...input,
    financeiro_resolvido: financeiro,
    financeiro_fonte: meta.fonte,
    financeiro_regional_key: meta.regional_key,
  };
}

function attachFinanceiroMeta(
  resultado: DimensionamentoResultado,
  input: DimensionamentoInput,
): void {
  const fin = financeiro(input);
  resultado.financeiro_aplicado = {
    minimo_garantido_semanal: fin.minimo_garantido_semanal,
    repasse_entregador_semanal: fin.repasse_entregador_semanal,
    custo_diaria: fin.custo_diaria,
    margem_minima_semanal: fin.margem_minima_semanal,
    valor_entrega_padrao: fin.valor_entrega_padrao,
  };
  resultado.financeiro_fonte = input.financeiro_fonte ?? 'workspace_default';
  resultado.financeiro_regional_key = input.financeiro_regional_key;
}

export function parseHorario(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) throw new DimensionamentoValidationError(`Horário inválido: ${hhmm}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) {
    throw new DimensionamentoValidationError(`Horário inválido: ${hhmm}`);
  }
  return h * 60 + min;
}

export function formatHorario(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function horasIntervalo(inicio: string, fim: string): number {
  const a = parseHorario(inicio);
  const b = parseHorario(fim);
  if (b <= a) return 0;
  return (b - a) / 60;
}

export function calcularDiasFuncionamento(input: Pick<
  DimensionamentoInput,
  'delivery_funciona_seg_sex' | 'delivery_funciona_sabado' | 'delivery_funciona_domingo'
>): number {
  let dias = 0;
  if (input.delivery_funciona_seg_sex) dias += 5;
  if (input.delivery_funciona_sabado) dias += 1;
  if (input.delivery_funciona_domingo) dias += 1;
  return dias;
}

export function calcularProdutividadeCidade(
  perfil: CidadePerfil,
  motor: CommercialMotorConfig = DEFAULT_MOTOR_CONFIG,
): number {
  return motor.produtividade_por_cidade[perfil];
}

function resolveValorEntrega(input: DimensionamentoInput): number {
  const cfg = financeiro(input);
  if (input.valor_entrega_informado != null && input.valor_entrega_informado > 0) {
    return input.valor_entrega_informado;
  }
  if (input.preco_cidade != null && input.preco_cidade > 0) return input.preco_cidade;
  const configured = lookupConfiguredCityPrice(input.motor_config, input.cidade, input.estado);
  if (configured != null && configured > 0) return configured;
  return cfg.valor_entrega_padrao;
}

function resolveEntregasMes(input: DimensionamentoInput, diasSemana: number): number {
  if (input.entregas_media_mes != null && input.entregas_media_mes > 0) {
    return input.entregas_media_mes;
  }
  return Math.round(input.entregas_media_dia * diasSemana * (52 / 12));
}

function classificarPerfil(
  entregasDia: number,
  _receitaSemanal: number,
  input: DimensionamentoInput,
): PerfilOperacao {
  const faixas = input.motor_config.faixas_perfil;
  if (entregasDia <= faixas.muito_baixa_max_dia) return 'muito_baixa';
  if (entregasDia <= faixas.reduzida_max_dia) return 'reduzida';
  if (entregasDia <= faixas.intermediaria_max_dia) return 'intermediaria';
  if (entregasDia <= faixas.padrao_max_dia) return 'padrao';
  return 'grande';
}

function dimensionarEntregadores(
  perfil: PerfilOperacao,
  entregasDia: number,
  produtividade: number,
  motor: CommercialMotorConfig,
): number {
  const dim = motor.dimensionamento;
  switch (perfil) {
    case 'muito_baixa':
      return 0;
    case 'reduzida':
      return 1;
    case 'intermediaria':
      return dim.entregadores_intermediaria;
    case 'padrao':
      return Math.max(1, Math.ceil(entregasDia / produtividade));
    case 'grande': {
      const base = Math.max(1, Math.ceil(entregasDia / produtividade));
      return Math.ceil(base * dim.fator_grande);
    }
    default:
      return 1;
  }
}

function dimensionarDiarias(
  perfil: PerfilOperacao,
  entregadores: number,
  motor: CommercialMotorConfig,
): number {
  const dim = motor.dimensionamento;
  switch (perfil) {
    case 'muito_baixa':
      return entregadores > 0 ? 1 : 0;
    case 'reduzida':
      return dim.diarias_reduzida;
    case 'intermediaria':
      return dim.diarias_intermediaria;
    case 'padrao':
      return Math.max(1, Math.ceil(entregadores / dim.diarias_padrao_divisor));
    case 'grande':
      return Math.max(dim.diarias_grande_minimo, Math.ceil(entregadores * dim.diarias_grande_fator) + 1);
    default:
      return 0;
  }
}

function shouldOfferDualScenarios(
  input: DimensionamentoInput,
  entregasDia: number,
  amplo: boolean,
): boolean {
  if (!input.delivery_hours_informed || !amplo) return false;
  return entregasDia <= input.motor_config.faixas_perfil.intermediaria_max_dia;
}

function semanasPorMes(): number {
  return 52 / 12;
}

/** Projeta faturamento farmácia, margem Flux (30%) e valor do lead (margem mensal × 12 meses). */
export function calcularProjecaoComercial(params: {
  entregadores: number;
  diarias: number;
  receitaTaxasSemanal: number;
  valorEntrega: number;
  diasSemana: number;
  cfg: ConfiguracoesGlobais;
  margemPct: number;
}): Omit<
  CenarioOperacionalProposta,
  'id' | 'titulo' | 'recomendado' | 'horario_delivery_considerado' | 'sugestao_comercial' | 'sugestao_escala'
> & { receita_taxas_semanal: number; receita_anual_farmacia: number } {
  const { entregadores, diarias, receitaTaxasSemanal, valorEntrega, diasSemana, cfg, margemPct: pct } =
    params;
  const custoMinimo = entregadores * cfg.minimo_garantido_semanal;
  const custoDiarias = diarias * cfg.custo_diaria;
  const repasse = entregadores * cfg.repasse_entregador_semanal;
  const faturamentoMgSemanal = custoMinimo + custoDiarias;
  const custoFarmaciaSemana = faturamentoMgSemanal;

  const usaPorEntrega =
    entregadores > 0 && receitaTaxasSemanal >= faturamentoMgSemanal && receitaTaxasSemanal > 0;
  const modelo: ModeloCobrancaFarmacia = usaPorEntrega ? 'por_entrega' : 'minimo_garantido';

  const faturamentoSemanal =
    entregadores === 0
      ? receitaTaxasSemanal
      : modelo === 'por_entrega'
        ? receitaTaxasSemanal
        : faturamentoMgSemanal;

  const faturamentoMensal = faturamentoSemanal * semanasPorMes();
  const margemFluxSemanal = faturamentoSemanal * pct;
  const margemFluxMensal = faturamentoMensal * pct;
  const valorLeadAnualCents = Math.round(margemFluxMensal * 12 * 100);
  const receitaAnualFarmacia = faturamentoMensal * 12;

  const pontoEquilibrioSemana =
    entregadores > 0 && valorEntrega > 0 ? faturamentoMgSemanal / valorEntrega : 0;
  const pontoEquilibrioDia = diasSemana > 0 ? pontoEquilibrioSemana / diasSemana : 0;

  let classificacao: ClassificacaoViabilidade;
  if (entregadores === 0) {
    classificacao = 'nao_viavel';
  } else if (modelo === 'minimo_garantido') {
    classificacao = 'viavel';
  } else {
    classificacao = classificarViabilidade(
      receitaTaxasSemanal,
      repasse,
      custoMinimo,
      custoDiarias,
      entregadores * cfg.margem_minima_semanal,
    );
  }

  const margemBruta =
    modelo === 'por_entrega'
      ? receitaTaxasSemanal - repasse - custoDiarias
      : faturamentoMgSemanal - repasse - custoDiarias;
  const resultadoOperacional =
    modelo === 'por_entrega'
      ? receitaTaxasSemanal - custoMinimo - custoDiarias
      : faturamentoMgSemanal - custoMinimo - custoDiarias;

  return {
    quantidade_entregadores_recomendada: entregadores,
    quantidade_diarias_semana: diarias,
    custo_minimo_garantido_semana: custoMinimo,
    custo_diarias_semana: custoDiarias,
    repasse_entregadores_semana: repasse,
    margem_flux_semana: margemFluxSemanal,
    margem_flux_mensal: margemFluxMensal,
    modelo_cobranca: modelo,
    faturamento_semanal_farmacia: faturamentoSemanal,
    faturamento_mensal_farmacia: faturamentoMensal,
    valor_lead_anual_cents: valorLeadAnualCents,
    custo_farmacia_semana: custoFarmaciaSemana,
    receita_semanal_estimada: receitaTaxasSemanal,
    margem_bruta_estimada: margemBruta,
    resultado_operacional: resultadoOperacional,
    classificacao_viabilidade: classificacao,
    ponto_equilibrio_entregas_semana: Math.ceil(pontoEquilibrioSemana),
    ponto_equilibrio_entregas_dia: Math.ceil(pontoEquilibrioDia * 10) / 10,
    receita_taxas_semanal: receitaTaxasSemanal,
    receita_anual_farmacia: receitaAnualFarmacia,
  };
}

function financeiroCenario(params: {
  entregadores: number;
  diarias: number;
  receitaSemanal: number;
  valorEntrega: number;
  diasSemana: number;
  cfg: ConfiguracoesGlobais;
  margemPct: number;
}): Omit<
  CenarioOperacionalProposta,
  'id' | 'titulo' | 'recomendado' | 'horario_delivery_considerado' | 'sugestao_comercial' | 'sugestao_escala'
> {
  const proj = calcularProjecaoComercial({
    entregadores: params.entregadores,
    diarias: params.diarias,
    receitaTaxasSemanal: params.receitaSemanal,
    valorEntrega: params.valorEntrega,
    diasSemana: params.diasSemana,
    cfg: params.cfg,
    margemPct: params.margemPct,
  });
  const { receita_taxas_semanal: _r, receita_anual_farmacia: _a, ...rest } = proj;
  return rest;
}

function applyProjecaoFinanceira(
  resultado: DimensionamentoResultado,
  proj: ReturnType<typeof calcularProjecaoComercial>,
): void {
  resultado.modelo_cobranca = proj.modelo_cobranca;
  resultado.faturamento_semanal_farmacia = proj.faturamento_semanal_farmacia;
  resultado.faturamento_mensal_farmacia = proj.faturamento_mensal_farmacia;
  resultado.receita_semanal_estimada = proj.receita_taxas_semanal;
  resultado.receita_anual_estimada = proj.receita_anual_farmacia;
  resultado.valor_lead_anual_cents = proj.valor_lead_anual_cents;
  resultado.margem_flux_semana = proj.margem_flux_semana;
  resultado.margem_flux_mensal = proj.margem_flux_mensal;
  resultado.margem_bruta_estimada = proj.margem_bruta_estimada;
  resultado.resultado_operacional = proj.resultado_operacional;
  resultado.classificacao_viabilidade = proj.classificacao_viabilidade;
  resultado.ponto_equilibrio_entregas_semana = proj.ponto_equilibrio_entregas_semana;
  resultado.ponto_equilibrio_entregas_dia = proj.ponto_equilibrio_entregas_dia;
  resultado.custo_minimo_garantido_semana = proj.custo_minimo_garantido_semana;
  resultado.custo_diarias_semana = proj.custo_diarias_semana;
  resultado.repasse_total_entregadores = proj.repasse_entregadores_semana;
  resultado.custo_farmacia_semana = proj.custo_farmacia_semana;
}

function horarioResumoCenario(input: DimensionamentoInput): string {
  const parts: string[] = [];
  if (input.delivery_funciona_seg_sex) {
    parts.push(`Seg–Sex ${input.horario_seg_sex_inicio}–${input.horario_seg_sex_fim}`);
  }
  if (input.delivery_funciona_sabado && input.horario_sabado_inicio) {
    parts.push(`Sáb ${input.horario_sabado_inicio}–${input.horario_sabado_fim ?? '—'}`);
  }
  if (input.delivery_funciona_domingo && input.horario_domingo_inicio) {
    parts.push(`Dom ${input.horario_domingo_inicio}–${input.horario_domingo_fim ?? '—'}`);
  }
  return parts.join(' · ');
}

function buildEnxutoInput(base: DimensionamentoInput): DimensionamentoInput {
  const ini = parseHorario(base.horario_seg_sex_inicio);
  const fim = parseHorario(base.horario_seg_sex_fim);
  const sugIni = Math.max(ini, parseHorario('10:00'));
  const sugFim = Math.min(fim, parseHorario('19:00'));
  return {
    ...base,
    horario_seg_sex_inicio: formatHorario(sugIni),
    horario_seg_sex_fim: formatHorario(sugFim),
    horario_sabado_inicio: base.delivery_funciona_sabado ? '08:00' : base.horario_sabado_inicio,
    horario_sabado_fim: base.delivery_funciona_sabado ? '14:00' : base.horario_sabado_fim,
    delivery_funciona_domingo: false,
  };
}

function buildDualOperationalScenarios(params: {
  input: DimensionamentoInput;
  entregasDia: number;
  entregasMes: number;
  valorEntrega: number;
  receitaSemanal: number;
  diasSemana: number;
}): CenarioOperacionalProposta[] {
  const { input, entregasDia, entregasMes, valorEntrega, receitaSemanal, diasSemana } = params;
  const cfg = financeiro(input);
  const pct = input.motor_config.valor_lead.margem_pct;
  const dim = input.motor_config.dimensionamento;
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const enxutoInput = buildEnxutoInput(input);
  const enxutoEntregadores = 1;
  const enxutoDiarias = 0;
  const enxutoFin = financeiroCenario({
    entregadores: enxutoEntregadores,
    diarias: enxutoDiarias,
    receitaSemanal,
    valorEntrega,
    diasSemana,
    cfg,
    margemPct: pct,
  });

  const integralEntregadores = dim.entregadores_intermediaria;
  const integralDiarias = dim.diarias_intermediaria;
  const integralFin = financeiroCenario({
    entregadores: integralEntregadores,
    diarias: integralDiarias,
    receitaSemanal,
    valorEntrega,
    diasSemana,
    cfg,
    margemPct: pct,
  });

  const mgEnxuto = brl(cfg.minimo_garantido_semanal);
  const diariaEnxuto = brl(cfg.custo_diaria);
  const fatEnxuto = brl(enxutoFin.faturamento_semanal_farmacia);
  const fatMensalEnxuto = brl(enxutoFin.faturamento_mensal_farmacia);

  const horEnx = horariosPropostaFromInput(enxutoInput, true, false);
  const horInt = horariosPropostaFromInput(input, false, false);
  const valorDiaria = cfg.custo_diaria;

  const enxuto: CenarioOperacionalProposta = {
    ...enxutoFin,
    id: 'enxuto',
    titulo: 'Cenário A — Horário enxuto sem domingo (recomendado)',
    recomendado: true,
    quantidade_entregadores_recomendada: enxutoEntregadores,
    quantidade_diarias_semana: enxutoDiarias,
    horario_delivery_considerado: `Seg–Sex ${horEnx.seg_a_sex} · Sáb ${horEnx.sabado} · Dom fechado`,
    sugestao_comercial: sugestaoComercialEnxuto({
      entregasMes,
      segSex: horEnx.seg_a_sex,
      sabado: horEnx.sabado,
      domingoAberto: false,
      custoSemana: fatEnxuto,
      valorDiaria,
      margemMes: brl(enxutoFin.margem_flux_mensal),
      valorLead: brl(enxutoFin.valor_lead_anual_cents / 100),
    }),
    sugestao_escala: ESCALA_VAZIA,
    resumo_operacional: resumoOperacionalEnxuto({
      entregasMes,
      entregasDia,
      segSex: horEnx.seg_a_sex,
      sabado: horEnx.sabado,
      domingoAberto: false,
      valorDiaria,
      omitDomingoHint: true,
    }),
  };

  const enxutoDomingoFin = financeiroCenario({
    entregadores: enxutoEntregadores,
    diarias: 1,
    receitaSemanal,
    valorEntrega,
    diasSemana,
    cfg,
    margemPct: pct,
  });
  const horEnxDom = horariosPropostaFromInput(enxutoInput, true, true);
  const domLead =
    input.horario_domingo_inicio && input.horario_domingo_fim
      ? formatHorarioDisplay(input.horario_domingo_inicio, input.horario_domingo_fim)
      : horEnxDom.domingo.replace(/\s*\(folguista\)/i, '');
  const fatEnxDom = brl(enxutoDomingoFin.faturamento_semanal_farmacia);

  const enxutoDomingo: CenarioOperacionalProposta = {
    ...enxutoDomingoFin,
    id: 'enxuto_domingo',
    titulo: 'Cenário A — Horário enxuto com domingo (folguista)',
    recomendado: false,
    quantidade_entregadores_recomendada: enxutoEntregadores,
    quantidade_diarias_semana: 1,
    horario_delivery_considerado: `Seg–Sex ${horEnxDom.seg_a_sex} · Sáb ${horEnxDom.sabado} · Dom ${horEnxDom.domingo}`,
    sugestao_comercial: sugestaoComercialEnxuto({
      entregasMes,
      segSex: horEnxDom.seg_a_sex,
      sabado: horEnxDom.sabado,
      domingoAberto: true,
      domingoLead: domLead,
      custoSemana: fatEnxDom,
      valorDiaria,
      margemMes: brl(enxutoDomingoFin.margem_flux_mensal),
      valorLead: brl(enxutoDomingoFin.valor_lead_anual_cents / 100),
    }),
    sugestao_escala: ESCALA_VAZIA,
    resumo_operacional: resumoOperacionalEnxuto({
      entregasMes,
      entregasDia,
      segSex: horEnxDom.seg_a_sex,
      sabado: horEnxDom.sabado,
      domingoAberto: true,
      domingoLead: domLead,
      valorDiaria,
      omitDomingoHint: true,
    }),
  };

  const fatIntegral = brl(integralFin.faturamento_semanal_farmacia);
  const modeloIntegral =
    integralFin.modelo_cobranca === 'por_entrega'
      ? `Volume atual (${entregasDia}/dia) sustenta cobrança por entrega — taxas ${brl(receitaSemanal)}/sem.`
      : `Volume atual (${entregasDia}/dia) permanece no regime de mínimo garantido.`;

  const integral: CenarioOperacionalProposta = {
    ...integralFin,
    id: 'integral',
    titulo: 'Cenário B — Horário integral informado pelo lead',
    recomendado: false,
    quantidade_entregadores_recomendada: integralEntregadores,
    quantidade_diarias_semana: integralDiarias,
    horario_delivery_considerado: horarioResumoCenario(input),
    sugestao_comercial: sugestaoComercialIntegral({
      horarioResumo: horarioResumoCenario(input),
      custoSemana: fatIntegral,
      margemMes: brl(integralFin.margem_flux_mensal),
      modeloFrase: modeloIntegral,
    }),
    sugestao_escala: ESCALA_VAZIA,
    resumo_operacional: resumoOperacionalIntegral({
      horarioResumo: horarioResumoCenario(input),
      domingoDisplay: horInt.domingo,
      modeloLabel:
        integralFin.modelo_cobranca === 'por_entrega' ? 'por entrega' : 'mínimo garantido',
    }),
  };

  if (integralFin.modelo_cobranca === 'por_entrega' && integralFin.classificacao_viabilidade === 'viavel') {
    integral.recomendado = true;
    enxuto.recomendado = false;
  }

  return [
    enrichCenarioFinanceiro(enxuto),
    enrichCenarioFinanceiro(enxutoDomingo),
    enrichCenarioFinanceiro(integral),
  ];
}

/** Recalcula cenário A com 0 ou 1 diária conforme domingo aberto (folguista). */
export function applyEnxutoDomingoAberto(
  resultado: DimensionamentoResultado,
  input: DimensionamentoInput,
  ativo: boolean,
): void {
  if (!resultado.cenarios_alternativos?.length) return;
  const cfg = financeiro(input);
  const pct = input.motor_config.valor_lead.margem_pct;
  const receitaSemanal = resultado.receita_semanal_estimada;
  const valorEntrega = resultado.valor_entrega_utilizado;
  const diasSemana = resultado.dias_funcionamento_semana ?? 6;
  const entregasMes = resultado.entregas_media_mes;
  const entregasDia = resultado.entregas_media_dia;
  const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const patchEnxuto = (base: CenarioOperacionalProposta): CenarioOperacionalProposta => {
    const diarias = ativo ? 1 : 0;
    const fin = financeiroCenario({
      entregadores: 1,
      diarias,
      receitaSemanal,
      valorEntrega,
      diasSemana,
      cfg,
      margemPct: pct,
    });
    const enxutoInput = buildEnxutoInput(input);
    const hor = horariosPropostaFromInput(enxutoInput, true, ativo);
    const domLead =
      ativo && input.horario_domingo_inicio && input.horario_domingo_fim
        ? formatHorarioDisplay(input.horario_domingo_inicio, input.horario_domingo_fim)
        : undefined;
    const next: CenarioOperacionalProposta = {
      ...base,
      ...fin,
      quantidade_diarias_semana: diarias,
      horario_delivery_considerado: `Seg–Sex ${hor.seg_a_sex} · Sáb ${hor.sabado} · ${
        ativo ? `Dom ${hor.domingo}` : 'Dom fechado'
      }`,
      sugestao_comercial: sugestaoComercialEnxuto({
        entregasMes,
        segSex: hor.seg_a_sex,
        sabado: hor.sabado,
        domingoAberto: ativo,
        domingoLead: domLead,
        custoSemana: brl(fin.faturamento_semanal_farmacia),
        valorDiaria: cfg.custo_diaria,
        margemMes: brl(fin.margem_flux_mensal),
        valorLead: brl(fin.valor_lead_anual_cents / 100),
      }),
      resumo_operacional: resumoOperacionalEnxuto({
        entregasMes,
        entregasDia,
        segSex: hor.seg_a_sex,
        sabado: hor.sabado,
        domingoAberto: ativo,
        domingoLead: ativo ? hor.domingo : undefined,
        valorDiaria: cfg.custo_diaria,
      }),
      sugestao_escala: ESCALA_VAZIA,
    };
    return enrichCenarioFinanceiro(next);
  };

  resultado.cenarios_alternativos = resultado.cenarios_alternativos.map((c) =>
    c.id === 'enxuto' ? patchEnxuto(c) : c,
  );

  if (resultado.cenario_selecionado === 'enxuto') {
    const enx = resultado.cenarios_alternativos.find((c) => c.id === 'enxuto')!;
    applyCenarioToResultado(resultado, enx, resultado.cenarios_alternativos, true);
    resultado.proposta_textual = gerarPropostaTextual(resultado);
  }
}

function applyCenarioToResultado(
  resultado: DimensionamentoResultado,
  cenario: CenarioOperacionalProposta,
  cenarios: CenarioOperacionalProposta[],
  markSelected = true,
): void {
  resultado.perfil_operacao = cenario.id === 'integral' ? 'intermediaria' : 'reduzida';
  resultado.quantidade_entregadores_recomendada = cenario.quantidade_entregadores_recomendada;
  resultado.quantidade_diarias_semana = cenario.quantidade_diarias_semana;
  resultado.horario_delivery_considerado = cenario.horario_delivery_considerado;
  resultado.sugestao_comercial = cenario.sugestao_comercial;
  resultado.sugestao_escala = cenario.sugestao_escala;
  resultado.custo_minimo_garantido_semana = cenario.custo_minimo_garantido_semana;
  resultado.custo_diarias_semana = cenario.custo_diarias_semana;
  resultado.repasse_total_entregadores = cenario.repasse_entregadores_semana;
  resultado.margem_bruta_estimada = cenario.margem_bruta_estimada;
  resultado.resultado_operacional = cenario.resultado_operacional;
  resultado.classificacao_viabilidade = cenario.classificacao_viabilidade;
  resultado.margem_flux_semana = cenario.margem_flux_semana;
  resultado.margem_flux_mensal = cenario.margem_flux_mensal;
  resultado.modelo_cobranca = cenario.modelo_cobranca;
  resultado.faturamento_semanal_farmacia = cenario.faturamento_semanal_farmacia;
  resultado.faturamento_mensal_farmacia = cenario.faturamento_mensal_farmacia;
  resultado.valor_lead_anual_cents = cenario.valor_lead_anual_cents;
  resultado.custo_farmacia_semana = cenario.custo_farmacia_semana;
  resultado.receita_semanal_estimada = cenario.receita_semanal_estimada;
  resultado.receita_anual_estimada = cenario.faturamento_mensal_farmacia * 12;
  resultado.ponto_equilibrio_entregas_semana = cenario.ponto_equilibrio_entregas_semana;
  resultado.ponto_equilibrio_entregas_dia = cenario.ponto_equilibrio_entregas_dia;
  resultado.cenarios_alternativos = cenarios;
  if (markSelected) {
    resultado.cenario_selecionado = cenario.id;
    resultado.cenario_selecionado_titulo = cenario.titulo;
  }
}

/** Aplica cenário alternativo ao resultado; retorna false se id inválido. */
export function applyCenarioSelectionById(
  resultado: DimensionamentoResultado,
  cenarioId: CenarioOperacionalId,
): boolean {
  const cenarios = resultado.cenarios_alternativos;
  if (!cenarios?.length) return false;
  const raw = cenarios.find((c) => c.id === cenarioId);
  if (!raw) return false;
  const cenario = enrichCenarioFinanceiro(raw);
  applyCenarioToResultado(
    resultado,
    cenario,
    cenarios.map((c) => enrichCenarioFinanceiro(c)),
  );
  resultado.proposta_textual = gerarPropostaTextual(resultado);
  return true;
}

/** Reaplica seleção anterior após recálculo, ou usa o recomendado. */
export function reconcileCenarioSelecionado(
  resultado: DimensionamentoResultado,
  previousId?: CenarioOperacionalId | null,
): void {
  if (!resultado.cenarios_alternativos?.length) {
    resultado.cenario_selecionado = null;
    resultado.cenario_selecionado_titulo = undefined;
    return;
  }
  if (previousId && applyCenarioSelectionById(resultado, previousId)) return;
  const recomendado =
    resultado.cenarios_alternativos.find((c) => c.recomendado) ?? resultado.cenarios_alternativos[0];
  if (recomendado) {
    applyCenarioToResultado(resultado, recomendado, resultado.cenarios_alternativos, false);
    resultado.cenario_selecionado = null;
    resultado.cenario_selecionado_titulo = undefined;
    resultado.proposta_textual = gerarPropostaTextual(resultado);
  }
}

function horarioAmplo(input: DimensionamentoInput): boolean {
  const h = input.motor_config.horario;
  const segSex = horasIntervalo(input.horario_seg_sex_inicio, input.horario_seg_sex_fim);
  const sab =
    input.delivery_funciona_sabado && input.horario_sabado_inicio && input.horario_sabado_fim
      ? horasIntervalo(input.horario_sabado_inicio, input.horario_sabado_fim)
      : 0;
  return segSex >= h.seg_sex_horas_amplo || sab >= h.sabado_horas_amplo;
}

export function gerarSugestaoEscala(
  input: DimensionamentoInput,
  entregadores: number,
  perfil: PerfilOperacao,
  diariasSemana?: number,
): SugestaoEscala {
  const cfg = input.motor_config.escala_operacional ?? DEFAULT_ESCALA_OPERACIONAL;
  const reduzida = perfil === 'reduzida' || perfil === 'muito_baixa';

  const pack = montarSugestaoEscalaTexto({
    segSex: input.delivery_funciona_seg_sex
      ? { abertura: input.horario_seg_sex_inicio, fechamento: input.horario_seg_sex_fim, ativo: true }
      : undefined,
    sabado:
      input.delivery_funciona_sabado && input.horario_sabado_inicio && input.horario_sabado_fim
        ? { abertura: input.horario_sabado_inicio, fechamento: input.horario_sabado_fim, ativo: true }
        : undefined,
    domingo:
      input.delivery_funciona_domingo && input.horario_domingo_inicio && input.horario_domingo_fim
        ? { abertura: input.horario_domingo_inicio, fechamento: input.horario_domingo_fim, ativo: true }
        : undefined,
    nEntregadores: entregadores,
    diariasSemana,
    cfg,
    reduzida,
  });

  return {
    resumo: pack.resumo,
    turnos: pack.turnos,
    folgas: pack.folgas,
    horario_sugerido: pack.horario_sugerido,
  };
}

/** Alertas operacionais da escala (cobertura de intervalo, janela longa, etc.). */
export function gerarAlertasEscala(
  input: DimensionamentoInput,
  entregadores: number,
  perfil: PerfilOperacao,
  diariasSemana?: number,
): string[] {
  const cfg = input.motor_config.escala_operacional ?? DEFAULT_ESCALA_OPERACIONAL;
  const reduzida = perfil === 'reduzida' || perfil === 'muito_baixa';
  const pack = montarSugestaoEscalaTexto({
    segSex: input.delivery_funciona_seg_sex
      ? { abertura: input.horario_seg_sex_inicio, fechamento: input.horario_seg_sex_fim, ativo: true }
      : undefined,
    sabado:
      input.delivery_funciona_sabado && input.horario_sabado_inicio && input.horario_sabado_fim
        ? { abertura: input.horario_sabado_inicio, fechamento: input.horario_sabado_fim, ativo: true }
        : undefined,
    domingo:
      input.delivery_funciona_domingo && input.horario_domingo_inicio && input.horario_domingo_fim
        ? { abertura: input.horario_domingo_inicio, fechamento: input.horario_domingo_fim, ativo: true }
        : undefined,
    nEntregadores: entregadores,
    diariasSemana,
    cfg,
    reduzida,
  });
  return pack.alertas;
}

function sugestaoComercialPorPerfil(perfil: PerfilOperacao, input: DimensionamentoInput): string {
  if (!input.delivery_hours_informed) {
    return 'Complete os horários de delivery na ficha do lead antes de usar esta recomendação comercial.';
  }
  switch (perfil) {
    case 'muito_baixa':
      return 'Recomendamos reduzir o horário de delivery ou negociar mínimo garantido, pois o volume informado não sustenta um entregador dedicado durante todo o horário solicitado.';
    case 'reduzida':
      return 'Recomendamos iniciar com 1 entregador fixo em horário reduzido, com 1 diária semanal para cobertura de folga.';
    case 'intermediaria':
      return 'Recomendamos 2 entregadores divididos em dois turnos, com 2 diárias semanais para cobertura.';
    case 'padrao':
      return 'Recomendamos operação com entregadores fixos dimensionados pela média diária e escala com cobertura para folgas.';
    case 'grande':
      return 'Recomendamos dimensionamento com múltiplos turnos, folguista fixo e acompanhamento semanal dos indicadores.';
    default:
      return '';
  }
}

function classificarViabilidade(
  receitaSemanal: number,
  repasseTotal: number,
  custoMinimo: number,
  custoDiarias: number,
  margemMinimaTotal: number,
): ClassificacaoViabilidade {
  const custoTotalMinimo = custoMinimo + custoDiarias;
  const repasseComDiarias = repasseTotal + custoDiarias;

  if (receitaSemanal < repasseComDiarias) return 'nao_viavel';
  if (receitaSemanal >= custoTotalMinimo && receitaSemanal - repasseTotal - custoDiarias >= margemMinimaTotal) {
    return 'viavel';
  }
  if (receitaSemanal >= repasseComDiarias) return 'viavel_com_restricoes';
  return 'nao_viavel';
}

export function gerarPropostaTextual(resultado: DimensionamentoResultado): string {
  const brl = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return [
    `Proposta operacional — ${resultado.cidade}/${resultado.estado}`,
    '',
    `Perfil: ${resultado.perfil_operacao.replace(/_/g, ' ')}`,
    `Entregas médias: ${resultado.entregas_media_dia}/dia · ${resultado.entregas_media_mes}/mês`,
    `Valor por entrega: ${brl(resultado.valor_entrega_utilizado)}`,
    `Entregadores recomendados: ${resultado.quantidade_entregadores_recomendada}`,
    `Diárias/semana: ${resultado.quantidade_diarias_semana}`,
    '',
    `Receita potencial de taxas/semana: ${brl(resultado.receita_semanal_estimada)}`,
    resultado.modelo_cobranca
      ? `Modelo de cobrança: ${resultado.modelo_cobranca === 'minimo_garantido' ? 'mínimo garantido' : 'por entrega'}`
      : '',
    resultado.faturamento_semanal_farmacia != null
      ? `Faturamento farmácia/semana: ${brl(resultado.faturamento_semanal_farmacia)}`
      : '',
    resultado.faturamento_mensal_farmacia != null
      ? `Faturamento farmácia/mês: ${brl(resultado.faturamento_mensal_farmacia)}`
      : '',
    `Custo mínimo garantido/semana: ${brl(resultado.custo_minimo_garantido_semana ?? 0)}`,
    `Viabilidade: ${resultado.classificacao_viabilidade.replace(/_/g, ' ')}`,
    '',
    resultado.sugestao_comercial,
    '',
    resultado.margem_flux_semana != null
      ? `Margem Flux (30% do faturamento): ${brl(resultado.margem_flux_semana)}/semana${resultado.margem_flux_mensal != null ? ` · ${brl(resultado.margem_flux_mensal)}/mês` : ''}`
      : '',
    resultado.valor_lead_anual_cents
      ? `Valor do lead (margem mensal × 12): ${brl(resultado.valor_lead_anual_cents / 100)}`
      : '',
    ...(resultado.cenarios_alternativos?.length
      ? [
          '',
          'Cenários alternativos:',
          ...resultado.cenarios_alternativos.map(
            (c) =>
              `• ${c.titulo}${c.recomendado ? ' (recomendado)' : ''}: ${c.quantidade_entregadores_recomendada} entregador(es), ${c.quantidade_diarias_semana} diária(s)/semana, margem Flux ${brl(c.margem_flux_semana)}`,
          ),
        ]
      : []),
  ]
    .filter(Boolean)
    .join('\n');
}

export function validarDimensionamentoInput(input: DimensionamentoInput): void {
  if (!input.cidade?.trim()) throw new DimensionamentoValidationError('Cidade obrigatória.');
  if (!input.estado?.trim() || input.estado.trim().length !== 2) {
    throw new DimensionamentoValidationError('Estado (UF) obrigatório com 2 letras.');
  }
  if (input.entregas_media_dia < 0) {
    throw new DimensionamentoValidationError('Entregas médias/dia não podem ser negativas.');
  }
  if (!input.delivery_funciona_seg_sex && !input.delivery_funciona_sabado && !input.delivery_funciona_domingo) {
    throw new DimensionamentoValidationError('Informe ao menos um dia de funcionamento do delivery.');
  }
  if (input.delivery_funciona_seg_sex) {
    parseHorario(input.horario_seg_sex_inicio);
    parseHorario(input.horario_seg_sex_fim);
  }
}

export function calcularDimensionamentoOperacional(input: DimensionamentoInput): DimensionamentoResultado {
  validarDimensionamentoInput(input);
  const resolvedInput = ensureFinanceiroResolved(input);

  const cfg = financeiro(resolvedInput);
  const motor = resolvedInput.motor_config;
  const valorEntrega = resolveValorEntrega(resolvedInput);
  const diasSemana = calcularDiasFuncionamento(resolvedInput);
  const entregasDia = Math.max(0, resolvedInput.entregas_media_dia);
  const entregasMes = resolveEntregasMes(resolvedInput, diasSemana);
  const produtividade = calcularProdutividadeCidade(resolvedInput.perfil_cidade, motor);

  const entregasSemanais = entregasDia * diasSemana;
  const receitaSemanal = entregasSemanais * valorEntrega;

  const perfil = classificarPerfil(entregasDia, receitaSemanal, resolvedInput);
  const entregadores = dimensionarEntregadores(perfil, entregasDia, produtividade, motor);
  const diarias = dimensionarDiarias(perfil, entregadores, motor);

  const alertas: string[] = [];

  if (perfil === 'muito_baixa') {
    alertas.push(
      'Operação classificada como muito baixa — não recomendada para entregador dedicado em horário integral.',
    );
    alertas.push('Sugerir modelo com diarista, operação compartilhada ou redução de horário.');
    alertas.push('Alerta de inviabilidade econômica para horário integral dedicado.');
  }

  const pct = motor.valor_lead.margem_pct;
  const amplo = horarioAmplo(resolvedInput);
  const offerDual = shouldOfferDualScenarios(resolvedInput, entregasDia, amplo);

  const volMaxReduzida = motor.horario.volume_max_horario_amplo_reduzida;
  if (amplo && entregasDia <= volMaxReduzida && !offerDual) {
    alertas.push(
      'Horário amplo com volume baixo — considere reduzir janela de delivery ou operação com diarista.',
    );
  }

  const usedDefaultPrice =
    valorEntrega === cfg.valor_entrega_padrao &&
    !resolvedInput.valor_entrega_informado &&
    !resolvedInput.preco_cidade &&
    !lookupConfiguredCityPrice(motor, resolvedInput.cidade, resolvedInput.estado);
  if (usedDefaultPrice) {
    alertas.push(
      `Preço por entrega não cadastrado para ${resolvedInput.cidade}/${resolvedInput.estado} — utilizado valor padrão R$ ${cfg.valor_entrega_padrao.toFixed(2)}.`,
    );
  }

  const projecao = calcularProjecaoComercial({
    entregadores,
    diarias,
    receitaTaxasSemanal: receitaSemanal,
    valorEntrega,
    diasSemana,
    cfg,
    margemPct: pct,
  });

  if (entregadores === 0) {
    alertas.push('Sem entregador dedicado — operação não viável no modelo Flux.');
  } else if (
    projecao.modelo_cobranca === 'por_entrega' &&
    projecao.classificacao_viabilidade === 'nao_viavel'
  ) {
    alertas.push('Operação não viável no regime por entrega — taxas não cobrem repasse + diárias.');
  } else if (projecao.classificacao_viabilidade === 'viavel_com_restricoes') {
    alertas.push('Operação viável com restrições no regime por entrega.');
  }

  const sugestao_escala = ESCALA_VAZIA;
  const sugestao_comercial = sugestaoComercialPorPerfil(perfil, resolvedInput);

  const horarioParts: string[] = [];
  if (resolvedInput.delivery_funciona_seg_sex) {
    horarioParts.push(`Seg–Sex ${resolvedInput.horario_seg_sex_inicio}–${resolvedInput.horario_seg_sex_fim}`);
  }
  if (resolvedInput.delivery_funciona_sabado && resolvedInput.horario_sabado_inicio) {
    horarioParts.push(`Sáb ${resolvedInput.horario_sabado_inicio}–${resolvedInput.horario_sabado_fim ?? '—'}`);
  }
  if (resolvedInput.delivery_funciona_domingo && resolvedInput.horario_domingo_inicio) {
    horarioParts.push(`Dom ${resolvedInput.horario_domingo_inicio}–${resolvedInput.horario_domingo_fim ?? '—'}`);
  }

  const resultado: DimensionamentoResultado = {
    perfil_operacao: perfil,
    cidade: resolvedInput.cidade,
    estado: resolvedInput.estado.toUpperCase(),
    valor_entrega_utilizado: valorEntrega,
    entregas_media_dia: entregasDia,
    entregas_media_mes: entregasMes,
    dias_funcionamento_semana: diasSemana,
    horario_delivery_considerado: horarioParts.join(' · ') || '—',
    quantidade_entregadores_recomendada: entregadores,
    quantidade_diarias_semana: diarias,
    custo_diarias_semana: projecao.custo_diarias_semana,
    custo_minimo_garantido_semana: projecao.custo_minimo_garantido_semana,
    repasse_total_entregadores: projecao.repasse_entregadores_semana,
    receita_semanal_estimada: projecao.receita_taxas_semanal,
    margem_bruta_estimada: projecao.margem_bruta_estimada,
    resultado_operacional: projecao.resultado_operacional,
    ponto_equilibrio_entregas_semana: projecao.ponto_equilibrio_entregas_semana,
    ponto_equilibrio_entregas_dia: projecao.ponto_equilibrio_entregas_dia,
    classificacao_viabilidade: projecao.classificacao_viabilidade,
    receita_anual_estimada: projecao.receita_anual_farmacia,
    valor_lead_anual_cents: projecao.valor_lead_anual_cents,
    modelo_cobranca: projecao.modelo_cobranca,
    faturamento_semanal_farmacia: projecao.faturamento_semanal_farmacia,
    faturamento_mensal_farmacia: projecao.faturamento_mensal_farmacia,
    margem_flux_semana: projecao.margem_flux_semana,
    margem_flux_mensal: projecao.margem_flux_mensal,
    custo_farmacia_semana: projecao.custo_farmacia_semana,
    alertas,
    sugestao_escala,
    sugestao_comercial,
    proposta_textual: '',
  };

  if (offerDual) {
    const cenarios = buildDualOperationalScenarios({
      input: resolvedInput,
      entregasDia,
      entregasMes,
      valorEntrega,
      receitaSemanal,
      diasSemana,
    });
    const recomendado = cenarios.find((c) => c.recomendado) ?? cenarios[0];
    applyCenarioToResultado(resultado, recomendado, cenarios, false);
    resultado.cenario_selecionado = null;
    resultado.cenario_selecionado_titulo = undefined;
    resultado.proposta_textual = gerarPropostaTextual(resultado);
    alertas.push(
      'Três cenários gerados: A sem domingo (R$ 1.000/sem), A com domingo e folguista (R$ 1.250/sem) e B horário integral (R$ 2.500/sem). Escolha o que vai na proposta.',
    );
    resultado.alertas = [...alertas];
  }

  if (!resultado.proposta_textual) {
    resultado.proposta_textual = gerarPropostaTextual(resultado);
  }
  attachFinanceiroMeta(resultado, resolvedInput);
  return resultado;
}
