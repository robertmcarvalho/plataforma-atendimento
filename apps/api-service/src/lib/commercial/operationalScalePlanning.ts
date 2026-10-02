/**
 * Planejamento de escalas com jornada balanceada (8h permanência, 1h intervalo embutido, 7h em rota)
 * e cobertura mútua de intervalos via sobreposição de turnos.
 */

import type { EscalaOperacionalConfig } from './commercialMotorConfigCore';

export type TurnoPlanejado = {
  indice: number;
  entrada: string;
  saida: string;
  intervalo_inicio: string;
  intervalo_fim: string;
  horas_permanencia: number;
  horas_em_rota: number;
  coberto_no_intervalo_por?: number;
};

export type PlanoEscalaDia = {
  abertura: string;
  fechamento: string;
  duracao_horas: number;
  turnos: TurnoPlanejado[];
  alertas: string[];
  cobertura_continua: boolean;
};

function parseMin(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) throw new Error(`Horário inválido: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

function formatMin(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function duracaoHoras(abertura: string, fechamento: string): number {
  const a = parseMin(abertura);
  const b = parseMin(fechamento);
  if (b <= a) return 0;
  return (b - a) / 60;
}

function cfgEscala(cfg: EscalaOperacionalConfig) {
  return {
    jornadaMin: cfg.jornada_horas * 60,
    intervaloMin: cfg.intervalo_horas * 60,
    rotaMin: (cfg.jornada_horas - cfg.intervalo_horas) * 60,
  };
}

/** Dois entregadores: mesma carga (8h), intervalos distintos dentro da sobreposição (16h − D). */
export function planearDoisTurnos(
  abertura: string,
  fechamento: string,
  cfg: EscalaOperacionalConfig,
): PlanoEscalaDia {
  const { jornadaMin, intervaloMin, rotaMin } = cfgEscala(cfg);
  const open = parseMin(abertura);
  const close = parseMin(fechamento);
  const D = close - open;
  const alertas: string[] = [];

  const e1Entrada = open;
  const e1Saida = open + jornadaMin;
  const e2Saida = close;
  const e2Entrada = close - jornadaMin;
  const overlapMin = e1Saida - e2Entrada;

  if (overlapMin < intervaloMin * 2) {
    alertas.push(
      `Janela de ${duracaoHoras(abertura, fechamento).toFixed(1)}h exige sobreposição ≥ ${cfg.intervalo_horas * 2}h para cobrir intervalos — considere 3º entregador ou diária.`,
    );
  }

  const overlapStart = e2Entrada;
  const e1IntervaloInicio = overlapStart;
  const e1IntervaloFim = overlapStart + intervaloMin;
  const e2IntervaloInicio = overlapStart + intervaloMin;
  const e2IntervaloFim = overlapStart + intervaloMin * 2;

  const turnos: TurnoPlanejado[] = [
    {
      indice: 1,
      entrada: formatMin(e1Entrada),
      saida: formatMin(e1Saida),
      intervalo_inicio: formatMin(e1IntervaloInicio),
      intervalo_fim: formatMin(e1IntervaloFim),
      horas_permanencia: cfg.jornada_horas,
      horas_em_rota: cfg.jornada_horas - cfg.intervalo_horas,
      coberto_no_intervalo_por: 2,
    },
    {
      indice: 2,
      entrada: formatMin(e2Entrada),
      saida: formatMin(e2Saida),
      intervalo_inicio: formatMin(e2IntervaloInicio),
      intervalo_fim: formatMin(e2IntervaloFim),
      horas_permanencia: cfg.jornada_horas,
      horas_em_rota: cfg.jornada_horas - cfg.intervalo_horas,
      coberto_no_intervalo_por: 1,
    },
  ];

  return {
    abertura,
    fechamento,
    duracao_horas: D / 60,
    turnos,
    alertas,
    cobertura_continua: overlapMin >= intervaloMin * 2 && e1Entrada <= open && e2Saida >= close,
  };
}

/** Três ou mais: turnos escalonados com intervalos em sobreposições adjacentes. */
export function planearMultiplosTurnos(
  abertura: string,
  fechamento: string,
  nEntregadores: number,
  cfg: EscalaOperacionalConfig,
): PlanoEscalaDia {
  const { jornadaMin, intervaloMin } = cfgEscala(cfg);
  const open = parseMin(abertura);
  const close = parseMin(fechamento);
  const D = close - open;
  const alertas: string[] = [];

  if (nEntregadores < 3) {
    return planearDoisTurnos(abertura, fechamento, cfg);
  }

  const step = nEntregadores > 1 ? (D - jornadaMin) / (nEntregadores - 1) : 0;
  const turnos: TurnoPlanejado[] = [];

  for (let i = 0; i < nEntregadores; i++) {
    const entrada = open + Math.round(i * step);
    const saida = entrada + jornadaMin;
    let intervaloInicio = entrada + Math.floor(jornadaMin / 2) - Math.floor(intervaloMin / 2);
    let intervaloFim = intervaloInicio + intervaloMin;

    if (i < nEntregadores - 1) {
      const nextEntrada = open + Math.round((i + 1) * step);
      const overlapStart = nextEntrada;
      intervaloInicio = overlapStart;
      intervaloFim = overlapStart + intervaloMin;
    } else if (i > 0) {
      const prevSaida = open + Math.round((i - 1) * step) + jornadaMin;
      const prevEntrada = open + Math.round((i - 1) * step);
      const overlapStart = Math.max(prevEntrada, entrada - (jornadaMin - step));
      intervaloInicio = prevSaida - intervaloMin;
      intervaloFim = prevSaida;
      if (intervaloInicio < entrada) {
        intervaloInicio = entrada + Math.floor((saida - entrada) / 2) - Math.floor(intervaloMin / 2);
        intervaloFim = intervaloInicio + intervaloMin;
      }
    }

    turnos.push({
      indice: i + 1,
      entrada: formatMin(entrada),
      saida: formatMin(saida),
      intervalo_inicio: formatMin(intervaloInicio),
      intervalo_fim: formatMin(intervaloFim),
      horas_permanencia: cfg.jornada_horas,
      horas_em_rota: cfg.jornada_horas - cfg.intervalo_horas,
      coberto_no_intervalo_por: i > 0 ? i : i + 1 < nEntregadores ? i + 2 : undefined,
    });
  }

  if (D > cfg.janela_max_dupla_horas) {
    alertas.push(
      `Janela acima de ${cfg.janela_max_dupla_horas}h com ${nEntregadores} entregadores — validar cobertura contínua com o líder.`,
    );
  }

  return {
    abertura,
    fechamento,
    duracao_horas: D / 60,
    turnos,
    alertas,
    cobertura_continua: turnos.length > 0 && parseMin(turnos[0].entrada) <= open,
  };
}

/** Um entregador: jornada de 8h dentro da janela; intervalo sem cobertura se janela > 8h. */
export function planearUmTurno(
  abertura: string,
  fechamento: string,
  cfg: EscalaOperacionalConfig,
  reduzida = false,
): PlanoEscalaDia {
  const { jornadaMin, intervaloMin } = cfgEscala(cfg);
  const open = parseMin(abertura);
  const close = parseMin(fechamento);
  const D = close - open;
  const alertas: string[] = [];

  let entrada: number;
  let saida: number;

  if (reduzida || D <= jornadaMin) {
    if (D > jornadaMin) {
      entrada = open + Math.floor((D - jornadaMin) / 2);
      saida = entrada + jornadaMin;
    } else {
      entrada = open;
      saida = close;
    }
  } else {
    entrada = open;
    saida = open + jornadaMin;
    alertas.push(
      'Com 1 entregador a janela excede 8h — no intervalo não há cobertura; reduzir horário de delivery ou usar diarista/folguista.',
    );
  }

  const intervaloInicio = entrada + Math.floor((saida - entrada) / 2) - Math.floor(intervaloMin / 2);
  const intervaloFim = intervaloInicio + intervaloMin;

  return {
    abertura,
    fechamento,
    duracao_horas: D / 60,
    turnos: [
      {
        indice: 1,
        entrada: formatMin(entrada),
        saida: formatMin(saida),
        intervalo_inicio: formatMin(intervaloInicio),
        intervalo_fim: formatMin(intervaloFim),
        horas_permanencia: cfg.jornada_horas,
        horas_em_rota: cfg.jornada_horas - cfg.intervalo_horas,
      },
    ],
    alertas,
    cobertura_continua: saida - entrada >= D - intervaloMin,
  };
}

export function planearEscalaDia(
  abertura: string,
  fechamento: string,
  nEntregadores: number,
  cfg: EscalaOperacionalConfig,
  reduzida = false,
): PlanoEscalaDia {
  if (nEntregadores <= 0) {
    return {
      abertura,
      fechamento,
      duracao_horas: duracaoHoras(abertura, fechamento),
      turnos: [],
      alertas: ['Operação sem entregador dedicado em horário fixo.'],
      cobertura_continua: false,
    };
  }
  if (nEntregadores === 1) return planearUmTurno(abertura, fechamento, cfg, reduzida);
  if (nEntregadores === 2) return planearDoisTurnos(abertura, fechamento, cfg);
  return planearMultiplosTurnos(abertura, fechamento, nEntregadores, cfg);
}

function descreverTurno(t: TurnoPlanejado): string {
  const cobertura =
    t.coberto_no_intervalo_por != null
      ? ` — intervalo ${t.intervalo_inicio}–${t.intervalo_fim} coberto pelo Entregador ${t.coberto_no_intervalo_por}`
      : ` — intervalo ${t.intervalo_inicio}–${t.intervalo_fim}`;
  return (
    `Entregador ${t.indice}: ${t.entrada}–${t.saida} ` +
    `(${t.horas_em_rota}h em rota + ${t.horas_permanencia - t.horas_em_rota}h intervalo)${cobertura}`
  );
}

export function descreverDomingo(params: {
  deliveryAberto: boolean;
  horario?: string;
  nEntregadores: number;
  rotacaoMin: number;
  folguistaQuandoFechado: boolean;
  diariasSemana?: number;
}): { turno: string; folgas: string } {
  const { deliveryAberto, horario, nEntregadores, rotacaoMin, folguistaQuandoFechado, diariasSemana } =
    params;
  const diarias = diariasSemana ?? 0;

  if (!deliveryAberto) {
    if (nEntregadores === 1) {
      return {
        turno:
          'Domingo: delivery fechado — folguista (diarista) cobre a folga semanal do entregador fixo.',
        folgas:
          'Folga semanal aos domingos; 1 diária de folguista por semana (sábado é dia normal de operação).',
      };
    }
    const diariaTxt =
      diarias > 0
        ? `${diarias} diária${diarias > 1 ? 's' : ''} de folguista por semana`
        : 'cobertura via diarista/folguista';
    return {
      turno: `Domingo: delivery fechado — folguista(s) (diarista) cobrem a folga semanal dos ${nEntregadores} entregadores fixos.`,
      folgas: `Folga semanal aos domingos; ${diariaTxt} (sábado é dia normal de operação).`,
    };
  }

  if (nEntregadores === 1) {
    return {
      turno: `Domingo: delivery aberto ${horario ?? ''} — entregador fixo ou folguista conforme escala semanal.`,
      folgas:
        diarias >= 1
          ? `${diarias} diária(s) de folguista por semana para cobertura de folgas.`
          : 'Plantão dominical conforme volume.',
    };
  }

  if (nEntregadores === 2) {
    const folgas =
      diarias >= 2
        ? `${diarias} diárias de folguista por semana cobrem a folga semanal de cada entregador fixo (segunda a sábado).`
        : diarias === 1
          ? '1 diária de folguista por semana complementa a folga semanal; domingo alternado entre os 2 fixos.'
          : 'Folgas semanais alternadas entre os 2 entregadores fixos.';
    return {
      turno: `Domingo: delivery aberto ${horario ?? ''} — plantão dominical alternado entre os 2 entregadores fixos (escala semanal).`,
      folgas,
    };
  }

  if (nEntregadores >= rotacaoMin) {
    const folgas =
      diarias >= nEntregadores
        ? `${diarias} diárias de folguista por semana cobrem as folgas semanais dos entregadores fixos.`
        : `Domingos alternados entre os ${nEntregadores} entregadores; demais folgas cobertas conforme acordado com o líder.`;
    return {
      turno: `Domingo: delivery aberto ${horario ?? ''} — escala rotativa entre os ${nEntregadores} entregadores fixos.`,
      folgas,
    };
  }

  return {
    turno: `Domingo: delivery aberto ${horario ?? ''} — entregador fixo ou folguista conforme escala.`,
    folgas: folguistaQuandoFechado
      ? 'Domingos com plantão escalado; folguista de backup quando necessário.'
      : 'Plantão dominical conforme volume.',
  };
}

export function montarSugestaoEscalaTexto(params: {
  segSex?: { abertura: string; fechamento: string; ativo: boolean };
  sabado?: { abertura: string; fechamento: string; ativo: boolean };
  domingo?: { abertura: string; fechamento: string; ativo: boolean };
  nEntregadores: number;
  diariasSemana?: number;
  cfg: EscalaOperacionalConfig;
  reduzida?: boolean;
}): {
  resumo: string;
  turnos: string[];
  folgas: string;
  horario_sugerido: Record<string, string>;
  alertas: string[];
} {
  const { segSex, sabado, domingo, nEntregadores, diariasSemana, cfg, reduzida } = params;
  const turnos: string[] = [];
  const alertas: string[] = [];
  const horario_sugerido: Record<string, string> = {};

  if (segSex?.ativo) {
    const plano = planearEscalaDia(segSex.abertura, segSex.fechamento, nEntregadores, cfg, reduzida);
    horario_sugerido.seg_sex = `${segSex.abertura}–${segSex.fechamento}`;
    turnos.push(
      `Segunda a sexta, delivery das ${segSex.abertura} às ${segSex.fechamento}:`,
      ...plano.turnos.map(descreverTurno),
    );
    alertas.push(...plano.alertas);
  }

  if (sabado?.ativo && sabado.abertura && sabado.fechamento) {
    horario_sugerido.sabado = `${sabado.abertura}–${sabado.fechamento}`;
    if (nEntregadores >= 2) {
      const planoSab = planearEscalaDia(sabado.abertura, sabado.fechamento, Math.min(nEntregadores, 2), cfg);
      turnos.push(`Sábado, delivery das ${sabado.abertura} às ${sabado.fechamento}:`);
      turnos.push(...planoSab.turnos.map(descreverTurno));
    } else {
      turnos.push(`Sábado: entregador fixo das ${sabado.abertura} às ${sabado.fechamento}.`);
    }
  }

  const dom = descreverDomingo({
    deliveryAberto: Boolean(domingo?.ativo),
    horario:
      domingo?.ativo && domingo.abertura && domingo.fechamento
        ? `(${domingo.abertura}–${domingo.fechamento})`
        : undefined,
    nEntregadores,
    diariasSemana,
    rotacaoMin: cfg.rotacao_domingo_min_entregadores,
    folguistaQuandoFechado: cfg.folguista_domingo_se_delivery_fechado,
  });
  turnos.push(dom.turno);
  horario_sugerido.domingo = domingo?.ativo
    ? `${domingo!.abertura}–${domingo!.fechamento}`
    : 'Fechado ao delivery';

  const resumo =
    nEntregadores === 0
      ? 'Operação flexível sem entregador dedicado em horário fixo.'
      : `${nEntregadores} entregador(es) fixo(s), jornada de ${cfg.jornada_horas}h (${cfg.jornada_horas - cfg.intervalo_horas}h em rota + ${cfg.intervalo_horas}h intervalo), cobertura contínua do delivery.`;

  return { resumo, turnos, folgas: dom.folgas, horario_sugerido, alertas };
}
