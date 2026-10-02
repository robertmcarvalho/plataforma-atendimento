import { DEFAULT_OUT_OF_HOURS_MESSAGE } from '@plataforma/channel-runtime';

export type WorkspaceCatalogDefaults = {
  profiles: Array<{ code: string; label: string; sort_order: number }>;
  sectors: Array<{ sector_key: string; display_name: string; sort_order: number }>;
  demands: Array<{ profile_code: string; sector_key: string; demand_key: string; title: string; sort_order: number }>;
  demandRules: Array<{ demand_key: string; requires_pharmacy: boolean; metadata?: Record<string, unknown> }>;
  messages: Array<{ message_key: string; channel: string; content: string; metadata?: Record<string, unknown> }>;
  slaRules: Array<{ demand_key: string; profile_code?: string | null; settings: Record<string, unknown> }>;
  outOfHours: { channel: string; is_active: boolean; message: string; settings: Record<string, unknown> };
};

const QA_SLA_BASE = {
  first_response_action: 'alert_attendant',
  treatment_action: 'alert_and_reassign',
  resolution_action: 'escalate_supervisor',
  use_business_hours: true,
  business_hours_id: 'default',
  business_hours_label: 'Padrão · seg-sex 08h-18h',
} as const;

function slaPresetForDemand(demandKey: string): Record<string, unknown> {
  if (demandKey === 'ldr-setor') {
    return {
      ...QA_SLA_BASE,
      first_response_sla_minutes: 25,
      treatment_sla_minutes: 120,
      resolution_sla_minutes: 480,
    };
  }
  if (demandKey.includes('fin-') || demandKey.includes('ph-fin-')) {
    return {
      ...QA_SLA_BASE,
      first_response_sla_minutes: 15,
      treatment_sla_minutes: 90,
      resolution_sla_minutes: 360,
    };
  }
  if (demandKey.includes('tech')) {
    return {
      ...QA_SLA_BASE,
      first_response_sla_minutes: 15,
      treatment_sla_minutes: 60,
      resolution_sla_minutes: 240,
    };
  }
  if (demandKey.includes('crit')) {
    return {
      ...QA_SLA_BASE,
      first_response_sla_minutes: 10,
      treatment_sla_minutes: 45,
      resolution_sla_minutes: 180,
    };
  }
  if (demandKey.includes('benef')) {
    return {
      ...QA_SLA_BASE,
      first_response_sla_minutes: 30,
      treatment_sla_minutes: 120,
      resolution_sla_minutes: 480,
    };
  }
  return {
    ...QA_SLA_BASE,
    first_response_sla_minutes: 25,
    treatment_sla_minutes: 120,
    resolution_sla_minutes: 480,
  };
}

export function buildWorkspaceCatalogDefaults(): WorkspaceCatalogDefaults {
  const sectors = [
    { sector_key: 'operacional', display_name: 'Operacional', sort_order: 10 },
    { sector_key: 'atendimento-geral', display_name: 'Atendimento Geral', sort_order: 20 },
    { sector_key: 'financeiro', display_name: 'Financeiro', sort_order: 30 },
    { sector_key: 'suporte-tecnico', display_name: 'Suporte Técnico', sort_order: 40 },
  ];

  const demands = [
    { profile_code: 'driver', sector_key: 'operacional', demand_key: 'drv-op-cadastro', title: 'Dados cadastrais (PIX, telefone, e-mail)', sort_order: 10 },
    { profile_code: 'driver', sector_key: 'atendimento-geral', demand_key: 'drv-ag-mei', title: 'MEI — abertura e obrigações', sort_order: 10 },
    { profile_code: 'driver', sector_key: 'atendimento-geral', demand_key: 'drv-ag-cert', title: 'Certificado digital (e-CPF / ICP-Brasil)', sort_order: 20 },
    { profile_code: 'driver', sector_key: 'atendimento-geral', demand_key: 'drv-ag-benef', title: 'Benefícios e vales', sort_order: 30 },
    { profile_code: 'driver', sector_key: 'atendimento-geral', demand_key: 'drv-ag-comp', title: 'Comprovantes e declarações (IR, extrato)', sort_order: 40 },
    { profile_code: 'driver', sector_key: 'financeiro', demand_key: 'drv-fin-pag', title: 'Pagamento / repasse não recebido', sort_order: 10 },
    { profile_code: 'driver', sector_key: 'financeiro', demand_key: 'drv-fin-desc', title: 'Contestação de desconto na corrida', sort_order: 20 },
    { profile_code: 'driver', sector_key: 'financeiro', demand_key: 'drv-fin-adv', title: 'Adiantamento de valores', sort_order: 30 },
    { profile_code: 'driver', sector_key: 'suporte-tecnico', demand_key: 'drv-tech-app', title: 'App do entregador (login, erro, travamento)', sort_order: 10 },
    { profile_code: 'pharmacy', sector_key: 'operacional', demand_key: 'ph-op-escala', title: 'Escala / quadro / plantão', sort_order: 10 },
    { profile_code: 'pharmacy', sector_key: 'operacional', demand_key: 'ph-op-falta', title: 'Falta de entregador na loja', sort_order: 20 },
    { profile_code: 'pharmacy', sector_key: 'operacional', demand_key: 'ph-op-atraso', title: 'Atraso na coleta ou saída', sort_order: 30 },
    { profile_code: 'pharmacy', sector_key: 'operacional', demand_key: 'ph-op-cob', title: 'Cobertura / substituição de entregador', sort_order: 40 },
    { profile_code: 'pharmacy', sector_key: 'atendimento-geral', demand_key: 'ph-ag-cond', title: 'Conduta do entregador (reclamação)', sort_order: 10 },
    { profile_code: 'pharmacy', sector_key: 'financeiro', demand_key: 'ph-fin-fat', title: 'Fatura / repasse à farmácia', sort_order: 10 },
    { profile_code: 'pharmacy', sector_key: 'financeiro', demand_key: 'ph-fin-cont', title: 'Contestação de cobrança ou valor', sort_order: 20 },
    { profile_code: 'pharmacy', sector_key: 'suporte-tecnico', demand_key: 'ph-tech-lenta', title: 'Plataforma lenta ou indisponível', sort_order: 10 },
    { profile_code: 'pharmacy', sector_key: 'suporte-tecnico', demand_key: 'ph-tech-duv', title: 'Como usar a plataforma de gestão', sort_order: 20 },
    { profile_code: 'pharmacy', sector_key: 'suporte-tecnico', demand_key: 'ph-tech-bug', title: 'Erro ou falha na gestão de entregas', sort_order: 30 },
  ];

  return {
    profiles: [
      { code: 'driver', label: 'Entregador', sort_order: 10 },
      { code: 'pharmacy', label: 'Farmácia', sort_order: 20 },
      { code: 'leader', label: 'Líder', sort_order: 30 },
    ],
    sectors,
    demands,
    demandRules: demands.map((item) => ({
      demand_key: item.demand_key,
      requires_pharmacy: item.profile_code === 'driver',
      metadata: item.profile_code === 'driver' ? { preferred_route: 'pharmacy_attendant' } : {},
    })),
    messages: [
      {
        message_key: 'driver_greeting_list',
        channel: 'whatsapp',
        content: 'Olá! Como posso te ajudar? Toque em Ver setores e escolha o tipo de atendimento:',
      },
      {
        message_key: 'ask_driver_name',
        channel: 'whatsapp',
        content: 'Qual é o seu nome completo?',
      },
      {
        message_key: 'ask_driver_city',
        channel: 'whatsapp',
        content: 'Em qual cidade você atua? (digite o nome da cidade)',
      },
      {
        message_key: 'auto_reply_out_of_hours',
        channel: 'whatsapp',
        content: DEFAULT_OUT_OF_HOURS_MESSAGE,
      },
    ],
    slaRules: [
      { demand_key: 'ldr-setor', profile_code: 'leader', settings: slaPresetForDemand('ldr-setor') },
      ...demands.map((item) => ({
        demand_key: item.demand_key,
        profile_code: item.profile_code,
        settings: slaPresetForDemand(item.demand_key),
      })),
    ],
    outOfHours: {
      channel: 'whatsapp',
      is_active: false,
      message: DEFAULT_OUT_OF_HOURS_MESSAGE,
      settings: { fallback_sector: 'atendimento-geral' },
    },
  };
}
