import type { DimensionamentoResultado } from './operationalDimensioning';
import type { PropostaComercialSnapshot } from './commercialSnapshotFinance';
import {
  formatBrlCents,
  formatBrlValue,
  formatSetupPagamento,
  horariosPropostaFromInput,
  textoEscalaResumida,
  textoFolguista,
  type HorariosLeadInput,
} from './commercialOperationalCopy';

export type ProposalDocumentVars = {
  nome_fantasia: string;
  razao_social: string;
  cnpj: string;
  contato: string;
  taxa_1: string;
  qt_entregas: string;
  minimo_garantido: string;
  setup: string;
  setup_pagamento: string;
  qt_entregadores: string;
  qt_diarias_semana: string;
  valor_diaria: string;
  seg_a_sex: string;
  sabado: string;
  domingo: string;
  feriados: string;
  texto_folguista: string;
  texto_escala_resumida: string;
  data_proposta: string;
  sugestao_comercial: string;
};

export function proposalVarsToMergeTags(vars: ProposalDocumentVars): Record<string, string> {
  return {
    NOME_FANTASIA: vars.nome_fantasia,
    RAZAO_SOCIAL: vars.razao_social,
    CNPJ: vars.cnpj,
    CONTATO: vars.contato,
    TAXA_1: vars.taxa_1,
    QT_ENTREGAS: vars.qt_entregas,
    MINIMO_GARANTIDO: vars.minimo_garantido,
    SETUP: vars.setup,
    SETUP_PAGAMENTO: vars.setup_pagamento,
    QT_ENTREGADORES: vars.qt_entregadores,
    QT_DIARIAS_SEMANA: vars.qt_diarias_semana,
    VALOR_DIARIA: vars.valor_diaria,
    SEG_A_SEX: vars.seg_a_sex,
    SAB: vars.sabado,
    DOM: vars.domingo,
    FER: vars.feriados,
    TEXTO_FOLGUISTA: vars.texto_folguista,
    TEXTO_ESCALA_RESUMIDA: vars.texto_escala_resumida,
    DATA_PROPOSTA: vars.data_proposta,
  };
}

export function buildProposalDocumentVars(params: {
  lead: Record<string, unknown>;
  dimensionamento: DimensionamentoResultado;
  propostaComercial?: PropostaComercialSnapshot;
  generatedAt?: Date;
}): ProposalDocumentVars {
  const { lead, dimensionamento: d, propostaComercial: pc } = params;
  const ent = d.quantidade_entregadores_recomendada;
  const mg = (d.custo_minimo_garantido_semana ?? 0) / Math.max(1, ent);
  const valorDiaria =
    d.quantidade_diarias_semana > 0
      ? (d.custo_diarias_semana ?? 0) / d.quantidade_diarias_semana
      : 250;

  const domingoAberto =
    d.cenario_selecionado === 'enxuto_domingo' || d.cenario_selecionado === 'integral';
  const horarioEnxuto =
    d.cenario_selecionado === 'enxuto' || d.cenario_selecionado === 'enxuto_domingo';

  const horInput: HorariosLeadInput = {
    horario_seg_sex_inicio: String(lead.horario_seg_sex_inicio ?? '08:00'),
    horario_seg_sex_fim: String(lead.horario_seg_sex_fim ?? '18:00'),
    delivery_funciona_seg_sex: lead.delivery_seg_sex !== false,
    delivery_funciona_sabado: lead.delivery_sabado !== false,
    horario_sabado_inicio: String(lead.horario_sabado_inicio ?? '08:00'),
    horario_sabado_fim: String(lead.horario_sabado_fim ?? '14:00'),
    delivery_funciona_domingo: lead.delivery_domingo === true,
    horario_domingo_inicio: String(lead.horario_domingo_inicio ?? '08:00'),
    horario_domingo_fim: String(lead.horario_domingo_fim ?? '20:00'),
    delivery_funciona_feriados:
      lead.delivery_feriados === true || lead.deliver_on_holidays === true
        ? true
        : lead.delivery_feriados === false || lead.deliver_on_holidays === false
          ? false
          : undefined,
    horario_feriados_inicio: String(lead.horario_feriados_inicio ?? '10:00'),
    horario_feriados_fim: String(lead.horario_feriados_fim ?? '16:00'),
  };

  const hor = horariosPropostaFromInput(horInput, horarioEnxuto, domingoAberto);
  const valorTaxa = d.valor_entrega_utilizado;
  const qtEntregas =
    valorTaxa > 0
      ? String(Math.max(1, Math.ceil(mg / valorTaxa)))
      : String(Math.max(1, d.ponto_equilibrio_entregas_semana ?? 1));

  const setupPc: PropostaComercialSnapshot = {
    setup_cents: pc?.setup_cents ?? 0,
    sem_setup: pc?.sem_setup,
    setup_pagamento: pc?.setup_pagamento ?? 'a_vista',
    setup_parcelas: pc?.setup_parcelas,
  };

  const cnpjRaw = String(lead.cnpj ?? '').replace(/\D/g, '');
  const cnpjFmt =
    cnpjRaw.length === 14
      ? `${cnpjRaw.slice(0, 2)}.${cnpjRaw.slice(2, 5)}.${cnpjRaw.slice(5, 8)}/${cnpjRaw.slice(8, 12)}-${cnpjRaw.slice(12)}`
      : String(lead.cnpj ?? '—');

  const dateStr = (params.generatedAt ?? new Date()).toLocaleDateString('pt-BR');

  return {
    nome_fantasia: String(lead.trade_name ?? '—'),
    razao_social: String(lead.legal_name ?? lead.trade_name ?? '—'),
    cnpj: cnpjFmt,
    contato: String(lead.contact_name ?? lead.trade_name ?? '—'),
    taxa_1: formatBrlValue(d.valor_entrega_utilizado),
    qt_entregas: qtEntregas,
    minimo_garantido: formatBrlValue(mg),
    setup: setupPc.sem_setup ? '0,00' : formatBrlCents(setupPc.setup_cents),
    setup_pagamento: formatSetupPagamento(setupPc),
    qt_entregadores: String(ent),
    qt_diarias_semana: String(d.quantidade_diarias_semana),
    valor_diaria: formatBrlValue(valorDiaria),
    seg_a_sex: hor.seg_a_sex,
    sabado: hor.sabado,
    domingo: hor.domingo,
    feriados: hor.feriados,
    texto_folguista: textoFolguista({
      cenarioId: d.cenario_selecionado === 'integral' ? 'integral' : 'enxuto',
      domingoAberto: d.cenario_selecionado === 'integral' ? true : domingoAberto,
      diariasSemana: d.quantidade_diarias_semana,
      valorDiaria,
      domingoLead:
        horInput.horario_domingo_inicio && horInput.horario_domingo_fim
          ? { inicio: horInput.horario_domingo_inicio, fim: horInput.horario_domingo_fim }
          : undefined,
    }),
    texto_escala_resumida: textoEscalaResumida(
      d.cenario_selecionado === 'integral' ? 'integral' : 'enxuto',
      ent,
    ),
    data_proposta: dateStr,
    sugestao_comercial: d.sugestao_comercial,
  };
}

export type ProposalDocumentSource = {
  template_id: string;
  template_version: number;
  vars: ProposalDocumentVars;
};

export function buildDocumentSource(
  vars: ProposalDocumentVars,
  templateId: string,
  templateVersion: number,
): ProposalDocumentSource {
  return { template_id: templateId, template_version: templateVersion, vars };
}
