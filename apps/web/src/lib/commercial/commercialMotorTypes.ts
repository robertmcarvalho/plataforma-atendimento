export type CommercialMotorConfig = {
  version: 1;
  financeiro: {
    valor_entrega_padrao: number;
    minimo_garantido_semanal: number;
    repasse_entregador_semanal: number;
    margem_minima_semanal: number;
    custo_diaria: number;
  };
  produtividade_por_cidade: {
    pequena: number;
    media: number;
    grande: number;
  };
  faixas_perfil: {
    muito_baixa_max_dia: number;
    reduzida_max_dia: number;
    intermediaria_max_dia: number;
    padrao_max_dia: number;
  };
  dimensionamento: {
    entregadores_intermediaria: number;
    fator_grande: number;
    diarias_reduzida: number;
    diarias_intermediaria: number;
    diarias_padrao_divisor: number;
    diarias_grande_fator: number;
    diarias_grande_minimo: number;
  };
  horario: {
    seg_sex_horas_amplo: number;
    sabado_horas_amplo: number;
    volume_max_horario_amplo_reduzida: number;
  };
  valor_lead: {
    margem_pct: number;
    semanas_ano: number;
  };
  viabilidade: {
    entregas_por_entregador: number;
    volume_baixo: number;
    volume_alto: number;
  };
  escala_operacional: {
    jornada_horas: number;
    intervalo_horas: number;
    janela_max_dupla_horas: number;
    horario_default_seg_sex_inicio: string;
    horario_default_seg_sex_fim: string;
    sabado_delta_fim_horas: number;
    domingo_default_inicio: string;
    domingo_default_fim: string;
    folguista_domingo_se_delivery_fechado: boolean;
    rotacao_domingo_min_entregadores: number;
  };
  precos_cidade: Array<{
    estado: string;
    cidade: string;
    valor_entrega?: number;
    minimo_garantido_semanal?: number;
    repasse_entregador_semanal?: number;
    custo_diaria?: number;
    margem_minima_semanal?: number;
  }>;
};

export type MotorConfigResponse = {
  config: CommercialMotorConfig;
  is_default: boolean;
};

export type MotorSimulateRequest = {
  city: string;
  state: string;
  entregas_media_dia?: number;
  entregas_media_mes?: number;
  perfil_cidade?: 'pequena' | 'media' | 'grande';
  valor_entrega_informado?: number;
};

export type MotorSimulateResponse = {
  dimensionamento: {
    perfil_operacao: string;
    quantidade_entregadores_recomendada: number;
    quantidade_diarias_semana: number;
    classificacao_viabilidade: string;
    receita_semanal_estimada: number;
    valor_lead_anual_cents: number;
    valor_entrega_utilizado: number;
    alertas: string[];
  };
  preco_fonte: string;
  meta: {
    config_version: number;
    config_hash: string;
    config_applied_at: string;
  };
};
