import type { PropostaComercialSnapshot } from './commercialSnapshotFinance';

export type HorariosLeadInput = {
  horario_seg_sex_inicio: string;
  horario_seg_sex_fim: string;
  delivery_funciona_seg_sex: boolean;
  delivery_funciona_sabado: boolean;
  horario_sabado_inicio?: string;
  horario_sabado_fim?: string;
  delivery_funciona_domingo: boolean;
  horario_domingo_inicio?: string;
  horario_domingo_fim?: string;
  delivery_funciona_feriados?: boolean;
  horario_feriados_inicio?: string;
  horario_feriados_fim?: string;
};

export const ESCALA_VAZIA = {
  resumo: '',
  turnos: [] as string[],
  folgas: '',
  horario_sugerido: {} as Record<string, string>,
};

export function formatHorarioDisplay(inicio: string, fim: string): string {
  return `${inicio} às ${fim}`;
}

export function formatDomingoDisplay(params: {
  aberto: boolean;
  inicio?: string;
  fim?: string;
  folguista?: boolean;
}): string {
  if (!params.aberto) return 'Fechado ao delivery';
  const h =
    params.inicio && params.fim ? formatHorarioDisplay(params.inicio, params.fim) : 'Conforme lead';
  return params.folguista ? `${h} (folguista)` : h;
}

export function formatBrlValue(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatBrlCents(cents: number): string {
  return formatBrlValue(cents / 100);
}

export function formatSetupPagamento(pc: PropostaComercialSnapshot): string {
  if (pc.sem_setup) return 'Isento';
  const total = formatBrlCents(pc.setup_cents);
  if (pc.setup_pagamento !== 'parcelado') return `À vista — ${total}`;
  const n = Math.max(2, pc.setup_parcelas ?? 2);
  const parcela = Math.round(pc.setup_cents / n);
  return `Parcelado em ${n}x de ${formatBrlCents(parcela)} (total ${total})`;
}

export function textoFolguista(params: {
  cenarioId: 'enxuto' | 'integral';
  domingoAberto: boolean;
  diariasSemana: number;
  valorDiaria: number;
  domingoLead?: { inicio: string; fim: string };
}): string {
  const vd = formatBrlValue(params.valorDiaria);
  if (params.cenarioId === 'enxuto') {
    if (!params.domingoAberto) {
      return (
        `Para a folga semanal do entregador fixo, recomendamos fechar o delivery aos domingos, ` +
        `sem cobrança de diária de folguista. Se a farmácia desejar manter o domingo aberto` +
        (params.domingoLead
          ? ` (${formatHorarioDisplay(params.domingoLead.inicio, params.domingoLead.fim)})`
          : '') +
        `, utilize 1 folguista (diarista) com custo de R$ ${vd} por diária.`
      );
    }
    return (
      `Recomendamos 1 folguista (diarista) por semana, com custo de R$ ${vd} por diária, ` +
      `para cobrir o domingo aberto. O entregador fixo não trabalha aos domingos.`
    );
  }
  return (
    `Recomendamos ${params.diariasSemana} folguistas (diaristas) por semana, com custo de R$ ${vd} por diária, ` +
    `para cobrir o domingo aberto e as folgas dos entregadores fixos. ` +
    `Os entregadores cooperados não trabalham aos domingos.`
  );
}

export function textoEscalaResumida(cenarioId: 'enxuto' | 'integral', entregadores: number): string {
  if (cenarioId === 'enxuto') {
    return (
      `Operação com 1 entregador de segunda a sábado no horário indicado. ` +
      `Folgas e domingo conforme política acordada com o líder da região. ` +
      `Sem detalhamento de turnos nesta proposta.`
    );
  }
  return (
    `Operação com ${entregadores} entregadores de segunda a sábado no horário indicado. ` +
    `Domingo e folgas cobertos por folguistas. Ajustes de folga podem ser alinhados com o líder.`
  );
}

export function resumoOperacionalEnxuto(params: {
  entregasMes: number;
  entregasDia: number;
  segSex: string;
  sabado: string;
  domingoAberto: boolean;
  domingoLead?: string;
  valorDiaria: number;
  omitDomingoHint?: boolean;
}): string[] {
  const bullets = [
    `Com ~${params.entregasMes} entregas/mês (${params.entregasDia}/dia), recomendamos 1 entregador no horário enxuto.`,
    `Horário: Seg–Sex ${params.segSex} · Sáb ${params.sabado} · Dom: ${
      params.domingoAberto ? params.domingoLead ?? 'aberto (folguista)' : 'fechado (sem diária)'
    }.`,
    'Entregador fixo opera de segunda a sábado.',
  ];
  if (!params.domingoAberto && !params.omitDomingoHint) {
    bullets.push(
      `Ative "Domingo aberto com folguista" se a farmácia mantiver delivery no domingo (+1 diária de R$ ${formatBrlValue(params.valorDiaria)}).`,
    );
  }
  if (params.domingoAberto) {
    bullets.push('1 diária/semana de folguista no domingo; entregador fixo não trabalha aos domingos.');
  }
  return bullets;
}

export function resumoOperacionalIntegral(params: {
  horarioResumo: string;
  domingoDisplay: string;
  modeloLabel: string;
}): string[] {
  return [
    '2 entregadores fixos no horário integral informado pelo lead.',
    `Domingo: ${params.domingoDisplay} — folguistas; fixos não trabalham no domingo.`,
    '2 diárias/semana na proposta.',
    `Modelo de cobrança: ${params.modeloLabel}.`,
  ];
}

export function sugestaoComercialEnxuto(params: {
  entregasMes: number;
  segSex: string;
  sabado: string;
  domingoAberto: boolean;
  domingoLead?: string;
  custoSemana: string;
  valorDiaria: number;
  margemMes: string;
  valorLead: string;
}): string {
  const dom = params.domingoAberto
    ? `domingo aberto${params.domingoLead ? ` (${params.domingoLead})` : ''} com 1 folguista (1 diária de R$ ${formatBrlValue(params.valorDiaria)})`
    : 'domingo fechado (sem diária de folguista)';
  return (
    `Para o volume de ${params.entregasMes} entregas/mês, recomendamos operação enxuta: 1 entregador fixo, ` +
    `delivery Seg–Sex ${params.segSex} e Sáb ${params.sabado}, ${dom}. ` +
    `Custo estimado à farmácia: ${params.custoSemana}/semana. ` +
    `Margem Flux 30%: ${params.margemMes}/mês · valor do negócio 12m: ${params.valorLead}.`
  );
}

export function sugestaoComercialIntegral(params: {
  horarioResumo: string;
  custoSemana: string;
  margemMes: string;
  modeloFrase: string;
}): string {
  return (
    `Para manter o horário integral informado (${params.horarioResumo}), recomendamos 2 entregadores fixos ` +
    `(segunda a sábado) e 2 diárias/semana de folguista para domingo e folgas. ` +
    `Custo à farmácia: ${params.custoSemana}/semana. Entregadores fixos folgam aos domingos. ${params.modeloFrase} ` +
    `Margem Flux: ${params.margemMes}/mês.`
  );
}

function resolveFeriadosDisplay(
  input: HorariosLeadInput,
  domingoDisplay: string,
  enxuto: boolean,
): string {
  if (input.delivery_funciona_feriados === true && input.horario_feriados_inicio && input.horario_feriados_fim) {
    return formatHorarioDisplay(input.horario_feriados_inicio, input.horario_feriados_fim);
  }
  if (input.delivery_funciona_feriados === false) {
    return enxuto ? 'Fechado' : 'Fechado ao delivery';
  }
  return enxuto && domingoDisplay === 'Fechado ao delivery' ? 'Fechado' : domingoDisplay;
}

export function horariosPropostaFromInput(
  input: HorariosLeadInput,
  enxuto: boolean,
  domingoAbertoEnxuto: boolean,
): {
  seg_a_sex: string;
  sabado: string;
  domingo: string;
  feriados: string;
} {
  if (enxuto) {
    const ini = Math.max(parseHorarioMin(input.horario_seg_sex_inicio), parseHorarioMin('10:00'));
    const fim = Math.min(parseHorarioMin(input.horario_seg_sex_fim), parseHorarioMin('19:00'));
    const segSex = formatHorarioDisplay(formatMin(ini), formatMin(fim));
    const sab =
      input.delivery_funciona_sabado && input.horario_sabado_inicio && input.horario_sabado_fim
        ? formatHorarioDisplay('08:00', '14:00')
        : '—';
    const dom = domingoAbertoEnxuto
      ? formatDomingoDisplay({
          aberto: true,
          inicio: input.horario_domingo_inicio,
          fim: input.horario_domingo_fim,
          folguista: true,
        })
      : 'Fechado ao delivery';
    return {
      seg_a_sex: segSex,
      sabado: sab,
      domingo: dom,
      feriados: resolveFeriadosDisplay(input, dom, true),
    };
  }
  const segSex =
    input.delivery_funciona_seg_sex
      ? formatHorarioDisplay(input.horario_seg_sex_inicio, input.horario_seg_sex_fim)
      : '—';
  const sab =
    input.delivery_funciona_sabado && input.horario_sabado_inicio && input.horario_sabado_fim
      ? formatHorarioDisplay(input.horario_sabado_inicio, input.horario_sabado_fim)
      : '—';
  const dom =
    input.delivery_funciona_domingo && input.horario_domingo_inicio && input.horario_domingo_fim
      ? formatDomingoDisplay({
          aberto: true,
          inicio: input.horario_domingo_inicio,
          fim: input.horario_domingo_fim,
          folguista: true,
        })
      : 'Fechado ao delivery';
  return {
    seg_a_sex: segSex,
    sabado: sab,
    domingo: dom,
    feriados: resolveFeriadosDisplay(input, dom, false),
  };
}

function parseHorarioMin(h: string): number {
  const [a, b] = h.split(':').map(Number);
  return (a ?? 0) * 60 + (b ?? 0);
}

function formatMin(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
