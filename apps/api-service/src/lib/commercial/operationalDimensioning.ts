/**
 * Adaptadores de input (lead comercial → DimensionamentoInput) e re-export do core.
 */

export * from './operationalDimensioningCore';

import {
  DEFAULT_ESCALA_OPERACIONAL,
  resolveFinanceiroParaLead,
  type CidadePerfil,
  type CommercialMotorConfig,
} from './commercialMotorConfigCore';
import {
  DimensionamentoValidationError,
  formatHorario,
  parseHorario,
  type DimensionamentoInput,
} from './operationalDimensioningCore';

/** Converte lead comercial + motor config em input do dimensionamento. */
export function buildDimensionamentoInputFromLead(
  lead: Record<string, unknown>,
  motorConfig: CommercialMotorConfig,
  overrides: Partial<DimensionamentoInput> & { strict?: boolean } = {},
): DimensionamentoInput {
  const { strict, ...restOverrides } = overrides;
  const custom = (lead.custom_fields as Record<string, unknown>) || {};
  const monthly = Number(lead.monthly_deliveries ?? 0);
  const diasDefault = 6;
  const entregasDia =
    restOverrides.entregas_media_dia ??
    (monthly > 0 ? Math.max(1, Math.round(monthly / (diasDefault * (52 / 12)))) : 0);

  const hoursInformed = custom.delivery_hours_informed === true;
  const segSex = custom.delivery_seg_sex !== false;
  const sabado = custom.delivery_sabado !== false;
  const domingo = custom.delivery_domingo === true;

  if (strict && !hoursInformed) {
    throw new DimensionamentoValidationError(
      'Horários de delivery não informados. Preencha na ficha do lead.',
    );
  }

  const perfilRaw = String(custom.perfil_cidade || '').trim();
  let perfilCidade: CidadePerfil = 'media';
  if (perfilRaw === 'pequena' || perfilRaw === 'media' || perfilRaw === 'grande') {
    perfilCidade = perfilRaw;
  } else if (strict) {
    throw new DimensionamentoValidationError('Perfil da cidade é obrigatório.');
  }

  const escalaCfg = motorConfig.escala_operacional ?? DEFAULT_ESCALA_OPERACIONAL;

  const horarioSegInicio = strict
    ? requireTimeField(custom.horario_seg_sex_inicio, 'Horário seg–sex (início)', segSex)
    : String(custom.horario_seg_sex_inicio || escalaCfg.horario_default_seg_sex_inicio);
  const horarioSegFim = strict
    ? requireTimeField(custom.horario_seg_sex_fim, 'Horário seg–sex (fim)', segSex)
    : String(custom.horario_seg_sex_fim || escalaCfg.horario_default_seg_sex_fim);

  const horarioSabInicio = strict
    ? requireTimeField(custom.horario_sabado_inicio, 'Horário sábado (início)', sabado)
    : String(custom.horario_sabado_inicio || horarioSegInicio);
  const horarioSabFimDefault = (() => {
    try {
      const fimMin =
        parseHorario(horarioSegFim) + escalaCfg.sabado_delta_fim_horas * 60;
      return formatHorario(Math.max(parseHorario(horarioSabInicio), fimMin));
    } catch {
      return '20:00';
    }
  })();
  const horarioSabFim = strict
    ? requireTimeField(custom.horario_sabado_fim, 'Horário sábado (fim)', sabado)
    : String(custom.horario_sabado_fim || horarioSabFimDefault);

  let horarioDomInicio: string | undefined;
  let horarioDomFim: string | undefined;
  if (domingo) {
    horarioDomInicio = strict
      ? requireTimeField(custom.horario_domingo_inicio, 'Horário domingo (início)', true)
      : String(custom.horario_domingo_inicio || escalaCfg.domingo_default_inicio);
    horarioDomFim = strict
      ? requireTimeField(custom.horario_domingo_fim, 'Horário domingo (fim)', true)
      : String(custom.horario_domingo_fim || escalaCfg.domingo_default_fim);
  }

  if (strict && monthly <= 0) {
    throw new DimensionamentoValidationError('Informe o volume de entregas por mês.');
  }

  const cidade = String(lead.city || '');
  const estado = String(lead.state || '');
  const { financeiro: financeiroResolvido, meta: financeiroMeta } = resolveFinanceiroParaLead({
    motor: motorConfig,
    cidade,
    estado,
    leadCustomFields: custom,
  });

  const taxaInformada =
    typeof custom.valor_entrega_informado === 'number' && custom.valor_entrega_informado > 0
      ? custom.valor_entrega_informado
      : typeof custom.valor_entrega_informado === 'string' && Number(custom.valor_entrega_informado) > 0
        ? Number(custom.valor_entrega_informado)
        : undefined;

  return {
    cidade,
    estado,
    entregas_media_dia: entregasDia,
    entregas_media_mes: monthly || undefined,
    valor_entrega_informado: restOverrides.valor_entrega_informado ?? taxaInformada,
    horario_seg_sex_inicio: horarioSegInicio,
    horario_seg_sex_fim: horarioSegFim,
    horario_sabado_inicio: horarioSabInicio,
    horario_sabado_fim: horarioSabFim,
    horario_domingo_inicio: horarioDomInicio,
    horario_domingo_fim: horarioDomFim,
    delivery_funciona_seg_sex: segSex,
    delivery_funciona_sabado: sabado,
    delivery_funciona_domingo: domingo,
    perfil_cidade: perfilCidade,
    delivery_hours_informed: hoursInformed,
    tipo_operacao: 'simulacao',
    motor_config: motorConfig,
    financeiro_resolvido: financeiroResolvido,
    financeiro_fonte: financeiroMeta.fonte,
    financeiro_regional_key: financeiroMeta.regional_key,
    lead_custom_fields: custom,
    ...restOverrides,
  };
}

function requireTimeField(value: unknown, label: string, required: boolean): string {
  if (!required) return '08:00';
  const s = String(value || '').trim();
  if (!/^\d{1,2}:\d{2}$/.test(s)) {
    throw new DimensionamentoValidationError(`${label} é obrigatório.`);
  }
  return s;
}

/** Monta input mínimo para simulação sem lead cadastrado. */
export function buildDimensionamentoInputForSimulation(params: {
  city: string;
  state: string;
  motorConfig: CommercialMotorConfig;
  entregas_media_dia?: number;
  entregas_media_mes?: number;
  perfil_cidade?: CidadePerfil;
  valor_entrega_informado?: number;
  preco_cidade?: number | null;
}): DimensionamentoInput {
  const diasDefault = 6;
  let entregasDia = params.entregas_media_dia ?? 0;
  if (entregasDia === 0 && params.entregas_media_mes && params.entregas_media_mes > 0) {
    entregasDia = Math.max(1, Math.round(params.entregas_media_mes / (diasDefault * (52 / 12))));
  }

  const { financeiro: financeiroResolvido, meta: financeiroMeta } = resolveFinanceiroParaLead({
    motor: params.motorConfig,
    cidade: params.city,
    estado: params.state,
  });

  return {
    cidade: params.city,
    estado: params.state.toUpperCase(),
    entregas_media_dia: entregasDia,
    entregas_media_mes: params.entregas_media_mes,
    valor_entrega_informado: params.valor_entrega_informado,
    preco_cidade: params.preco_cidade,
    horario_seg_sex_inicio: '08:00',
    horario_seg_sex_fim: '22:00',
    horario_sabado_inicio: '08:00',
    horario_sabado_fim: '18:00',
    delivery_funciona_seg_sex: true,
    delivery_funciona_sabado: true,
    delivery_funciona_domingo: false,
    perfil_cidade: params.perfil_cidade ?? 'media',
    tipo_operacao: 'simulacao',
    motor_config: params.motorConfig,
    financeiro_resolvido: financeiroResolvido,
    financeiro_fonte: financeiroMeta.fonte,
    financeiro_regional_key: financeiroMeta.regional_key,
  };
}

