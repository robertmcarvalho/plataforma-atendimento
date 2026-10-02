export type CommercialLeadSource =
  | 'manual'
  | 'instagram'
  | 'indicacao'
  | 'whatsapp'
  | 'campanha'
  | 'referral'
  | 'other';

/** Classificação de engajamento (blueprint Lead scoring IA). Derivada no protótipo; persistida na API. */
export type LeadTemperature = 'frio' | 'morno' | 'quente' | 'urgente';

export type CommercialStage = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  probability: number;
  is_won?: boolean;
  is_lost?: boolean;
  is_entry?: boolean;
};

export type CommercialOwner = {
  id: string;
  name: string;
};

export type ContractChecklist = {
  total: number;
  filled: number;
  percent: number;
  missing: string[];
  complete: boolean;
};

export type ContractOnboardingStatus = 'awaiting_lead' | 'lead_submitted' | 'complete';

export type ContractOnboardingSeller = {
  legal_name?: string;
  trade_name?: string;
  delivery_fee_cents?: number | null;
  delivery_fee_driver_payout_cents?: number | null;
  minimum_guaranteed_cents?: number | null;
  minimum_guaranteed_driver_payout_cents?: number | null;
  setup_cents?: number | null;
  setup_parcelado?: boolean;
  setup_parcelas?: number | null;
  drivers_count?: number | null;
  delivery_schedule?: Record<string, unknown>;
  pickup_address_cep?: string;
  pickup_address_street?: string;
  pickup_address_number?: string;
  pickup_address_neighborhood?: string;
  pickup_address_complement?: string;
  pickup_city?: string;
  pickup_state?: string;
};

export type ContractOnboarding = {
  status: ContractOnboardingStatus;
  lead_submitted_at?: string | null;
  seller_completed_at?: string | null;
  data_request_id?: string | null;
  lead_snapshot?: Record<string, unknown> | null;
  seller?: ContractOnboardingSeller;
};

export type SellerContractChecklist = ContractChecklist;

export type CommercialNotification = {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  read_at?: string | null;
  created_at: string;
};

export type CommercialLead = {
  id: string;
  trade_name: string;
  legal_name?: string;
  phone: string;
  city: string;
  state: string;
  cnpj?: string | null;
  contact_name?: string | null;
  contact_email?: string;
  contact_role?: string;
  legal_representative_name?: string;
  legal_representative_cpf?: string;
  legal_representative_email?: string;
  legal_representative_phone?: string;
  address_cep?: string;
  address_street?: string;
  address_number?: string;
  address_neighborhood?: string;
  address_complement?: string;
  contact_expedition_name?: string;
  contact_expedition_phone?: string;
  contact_financial_name?: string;
  contact_financial_phone?: string;
  contract_checklist?: ContractChecklist;
  contract_onboarding?: ContractOnboarding;
  seller_contract_checklist?: SellerContractChecklist;
  contract_onboarding_complete?: boolean;
  stage_id: string;
  owner_id: string;
  source: CommercialLeadSource;
  monthly_deliveries?: number;
  drivers_count?: number;
  erp?: string;
  notes?: string;
  custom_fields?: Record<string, string | number | boolean>;
  ai_score?: number;
  ai_score_set_at?: string | null;
  ai_score_explanation?: string | null;
  lead_temperature?: LeadTemperature | null;
  /** Valor estimado do negócio (centavos BRL). */
  deal_value_cents?: number;
  /** Data prevista de fechamento (ISO date). */
  expected_close_at?: string;
  campaign?: string;
  updated_at: string;
  created_at: string;
  last_message_at?: string;
  loss_reason_id?: string;
  loss_notes?: string;
  converted_pharmacy_id?: string;
  tags?: string[];
  commercial_conversation_id?: string;
  operational_snapshot?: OperationalDimensioningResult | null;
  dimensionamento_confirmed?: boolean;
};

export type CommercialActivity = {
  id: string;
  lead_id: string;
  type:
    | 'stage_change'
    | 'message'
    | 'proposal'
    | 'note'
    | 'meeting'
    | 'loss'
    | 'won'
    | 'data_request_sent'
    | 'data_request_completed'
    | 'ai_scoring';
  title: string;
  detail?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
};

export type CommercialMessage = {
  id: string;
  lead_id: string;
  direction: 'inbound' | 'outbound';
  content: string;
  created_at: string;
  status?: 'sent' | 'delivered' | 'read';
};

export type LossReason = {
  id: string;
  name: string;
  active: boolean;
};

export type CommercialErpOption = {
  id: string;
  name: string;
  active: boolean;
  sort_order?: number;
};

export type FieldDefinition = {
  id: string;
  slug: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'date' | 'boolean';
  required: boolean;
  options?: string[];
  sort_order: number;
};

export type ViabilityResult = {
  city: string;
  state: string;
  volume: number;
  status: 'viavel' | 'atencao' | 'inviavel';
  summary: string;
  leader_available: boolean;
  estimated_drivers: number;
  aethera_drivers_in_city?: number;
  leaders_in_city?: number;
  valor_lead_anual_cents?: number;
  dimensionamento_confirmed?: boolean;
  dimensionamento?: OperationalDimensioningResult;
};

export type CenarioOperacionalProposta = {
  id: 'enxuto' | 'enxuto_domingo' | 'integral';
  titulo: string;
  recomendado: boolean;
  quantidade_entregadores_recomendada: number;
  quantidade_diarias_semana: number;
  horario_delivery_considerado: string;
  sugestao_comercial: string;
  sugestao_escala: {
    resumo: string;
    turnos: string[];
    folgas: string;
    horario_sugerido?: Record<string, string>;
  };
  custo_minimo_garantido_semana: number;
  custo_diarias_semana: number;
  custo_farmacia_semana?: number;
  repasse_entregadores_semana: number;
  margem_flux_semana: number;
  margem_flux_mensal?: number;
  modelo_cobranca?: 'minimo_garantido' | 'por_entrega';
  faturamento_semanal_farmacia?: number;
  faturamento_mensal_farmacia?: number;
  valor_lead_anual_cents?: number;
  receita_semanal_estimada: number;
  margem_bruta_estimada: number;
  resultado_operacional: number;
  classificacao_viabilidade: string;
};

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
  setup_parcelas?: number | null;
  cenario_a_domingo_aberto?: boolean;
  valor_lead_override_cents?: number | null;
  override_motivo?: string | null;
  ajustes_manuais?: AjusteComercialManual[];
};

export type OperationalDimensioningResult = {
  confirmed_at?: string | null;
  perfil_operacao: string;
  cidade?: string;
  estado?: string;
  valor_entrega_utilizado: number;
  entregas_media_dia: number;
  entregas_media_mes: number;
  dias_funcionamento_semana?: number;
  horario_delivery_considerado?: string;
  quantidade_entregadores_recomendada: number;
  quantidade_diarias_semana: number;
  custo_diarias_semana?: number;
  custo_minimo_garantido_semana?: number;
  repasse_total_entregadores?: number;
  receita_semanal_estimada: number;
  margem_bruta_estimada: number;
  resultado_operacional?: number;
  ponto_equilibrio_entregas_semana?: number;
  ponto_equilibrio_entregas_dia?: number;
  classificacao_viabilidade: string;
  valor_lead_anual_cents: number;
  alertas: string[];
  sugestao_comercial: string;
  proposta_textual: string;
  sugestao_escala: {
    resumo: string;
    turnos: string[];
    folgas: string;
    horario_sugerido?: Record<string, string>;
  };
  cenarios_alternativos?: CenarioOperacionalProposta[];
  margem_flux_semana?: number;
  margem_flux_mensal?: number;
  modelo_cobranca?: 'minimo_garantido' | 'por_entrega';
  faturamento_semanal_farmacia?: number;
  faturamento_mensal_farmacia?: number;
  custo_farmacia_semana?: number;
  cenario_selecionado?: 'enxuto' | 'enxuto_domingo' | 'integral' | null;
  cenario_selecionado_titulo?: string;
  proposta_comercial?: PropostaComercialSnapshot;
  financeiro_aplicado?: {
    minimo_garantido_semanal: number;
    repasse_entregador_semanal: number;
    custo_diaria: number;
    margem_minima_semanal: number;
    valor_entrega_padrao: number;
  };
  financeiro_fonte?: 'workspace_default' | 'regional' | 'lead_override';
  financeiro_regional_key?: string;
};

export type CommercialProposalStatus = 'draft' | 'pdf_ready' | 'sent' | 'accepted';

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

export type ProposalDocumentSource = {
  template_id: string;
  template_version: number;
  vars: ProposalDocumentVars;
};

export type CommercialProposal = {
  id: string;
  lead_id: string;
  version: number;
  status: CommercialProposalStatus;
  package_name: string;
  setup_cents: number;
  monthly_cents: number;
  mdr_pct: number;
  notes?: string | null;
  created_at: string;
  sent_at?: string;
  operational_snapshot?: OperationalDimensioningResult | null;
  document_source?: ProposalDocumentSource | null;
  document_saved_at?: string | null;
  template_version?: number | null;
  pdf_generated_at?: string | null;
  pdf_url?: string | null;
  docx_url?: string | null;
  has_pdf?: boolean;
  has_docx?: boolean;
  pdf_warning?: string | null;
  /** Legado — propostas novas não usam editor HTML. */
  document_html?: string | null;
  deal_value_cents?: number;
};
