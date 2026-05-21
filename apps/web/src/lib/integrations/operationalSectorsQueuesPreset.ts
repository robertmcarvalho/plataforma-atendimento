import type { ChannelDemand, ChannelOperationalConfig, ChannelQueue, ChannelSectorConfig, ChannelSlaSettings } from './channelsApi';
import { defaultChannelBusinessHours, defaultChannelMessages, defaultChannelProfilesConfig } from './channelsApi';

export const MACRO_SECTOR_NAMES = [
  'Operacional',
  'Atendimento Geral',
  'Financeiro',
  'Suporte Técnico',
] as const;

const SLA_ACTIONS: Pick<
  ChannelSlaSettings,
  'first_response_action' | 'treatment_action' | 'resolution_action' | 'use_business_hours' | 'business_hours_id'
> = {
  first_response_action: 'alert_attendant',
  treatment_action: 'alert_and_reassign',
  resolution_action: 'escalate_supervisor',
  use_business_hours: true,
  business_hours_id: 'default',
};

const QUEUE_GERAL_SLA: ChannelSlaSettings = {
  ...SLA_ACTIONS,
  first_response_sla_minutes: 25,
  treatment_sla_minutes: 120,
  resolution_sla_minutes: 480,
};

const QUEUE_ESPECIALIZADA_SLA: ChannelSlaSettings = {
  ...SLA_ACTIONS,
  first_response_sla_minutes: 15,
  treatment_sla_minutes: 75,
  resolution_sla_minutes: 300,
};

const DEMAND_ROWS: Array<{ sectorName: (typeof MACRO_SECTOR_NAMES)[number]; demandKey: string; title: string; driver: boolean }> = [
  { sectorName: 'Operacional', demandKey: 'drv-op-cadastro', title: 'Dados cadastrais (PIX, telefone, e-mail)', driver: true },
  { sectorName: 'Atendimento Geral', demandKey: 'drv-ag-mei', title: 'MEI — abertura e obrigações', driver: true },
  { sectorName: 'Atendimento Geral', demandKey: 'drv-ag-cert', title: 'Certificado digital (e-CPF / ICP-Brasil)', driver: true },
  { sectorName: 'Atendimento Geral', demandKey: 'drv-ag-benef', title: 'Benefícios e vales', driver: true },
  { sectorName: 'Atendimento Geral', demandKey: 'drv-ag-comp', title: 'Comprovantes e declarações (IR, extrato)', driver: true },
  { sectorName: 'Financeiro', demandKey: 'drv-fin-pag', title: 'Pagamento / repasse não recebido', driver: true },
  { sectorName: 'Financeiro', demandKey: 'drv-fin-desc', title: 'Contestação de desconto na corrida', driver: true },
  { sectorName: 'Financeiro', demandKey: 'drv-fin-adv', title: 'Adiantamento de valores', driver: true },
  { sectorName: 'Suporte Técnico', demandKey: 'drv-tech-app', title: 'App do entregador (login, erro, travamento)', driver: true },
  { sectorName: 'Operacional', demandKey: 'ph-op-escala', title: 'Escala / quadro / plantão', driver: false },
  { sectorName: 'Operacional', demandKey: 'ph-op-falta', title: 'Falta de entregador na loja', driver: false },
  { sectorName: 'Operacional', demandKey: 'ph-op-atraso', title: 'Atraso na coleta ou saída', driver: false },
  { sectorName: 'Operacional', demandKey: 'ph-op-cob', title: 'Cobertura / substituição de entregador', driver: false },
  { sectorName: 'Atendimento Geral', demandKey: 'ph-ag-cond', title: 'Conduta do entregador (reclamação)', driver: false },
  { sectorName: 'Financeiro', demandKey: 'ph-fin-fat', title: 'Fatura / repasse à farmácia', driver: false },
  { sectorName: 'Financeiro', demandKey: 'ph-fin-cont', title: 'Contestação de cobrança ou valor', driver: false },
  { sectorName: 'Suporte Técnico', demandKey: 'ph-tech-lenta', title: 'Plataforma lenta ou indisponível', driver: false },
  { sectorName: 'Suporte Técnico', demandKey: 'ph-tech-duv', title: 'Como usar a plataforma de gestão', driver: false },
  { sectorName: 'Suporte Técnico', demandKey: 'ph-tech-bug', title: 'Erro ou falha na gestão de entregas', driver: false },
];

function slaOverrideForDemandKey(demandKey: string): Partial<ChannelSlaSettings> | null {
  if (demandKey.includes('fin-') || demandKey.includes('ph-fin-')) {
    return { first_response_sla_minutes: 15, treatment_sla_minutes: 90, resolution_sla_minutes: 360 };
  }
  if (demandKey.includes('tech')) {
    return { first_response_sla_minutes: 15, treatment_sla_minutes: 60, resolution_sla_minutes: 240 };
  }
  if (demandKey.includes('benef')) {
    return { first_response_sla_minutes: 30, treatment_sla_minutes: 120, resolution_sla_minutes: 480 };
  }
  return null;
}

/** Monta config operacional usando UUIDs da tabela `sectors` (sectorsProp). */
export function buildOperationalSectorsQueuesPreset(sectorsFromDb: Array<{ id: string; name: string }>): ChannelOperationalConfig | null {
  const byName = new Map(sectorsFromDb.map((s) => [s.name.trim().toLowerCase(), s]));
  const sectorIdByName: Record<string, string> = {};
  for (const name of MACRO_SECTOR_NAMES) {
    const row = byName.get(name.toLowerCase());
    if (!row?.id) return null;
    sectorIdByName[name] = row.id;
  }

  const sectors: ChannelSectorConfig[] = MACRO_SECTOR_NAMES.map((name) => ({
    id: sectorIdByName[name],
    name,
    is_active: true,
    escalation_manager_id: null,
    escalation_manager_name: null,
  }));

  const queues: ChannelQueue[] = [
    {
      name: 'Geral',
      sector_ids: [sectorIdByName['Operacional'], sectorIdByName['Atendimento Geral']],
      capacity: 80,
      priority: 'medium',
      sla: { ...QUEUE_GERAL_SLA },
    },
    {
      name: 'Especializada',
      sector_ids: [sectorIdByName.Financeiro, sectorIdByName['Suporte Técnico']],
      capacity: 40,
      priority: 'high',
      overflow_queue_name: 'Geral',
      sla: { ...QUEUE_ESPECIALIZADA_SLA },
    },
  ];

  const demands: ChannelDemand[] = DEMAND_ROWS.map((row, index) => {
    const sectorId = sectorIdByName[row.sectorName];
    const override = slaOverrideForDemandKey(row.demandKey);
    return {
      id: row.demandKey,
      title: row.title,
      sector_ids: [sectorId],
      is_active: true,
      requires_pharmacy: row.driver,
      route_to: null,
      target_sector_id: null,
      target_queue_name: null,
      target_attendant_id: null,
      sla_override: override ? { ...SLA_ACTIONS, ...override } : null,
      sort_order: index + 1,
    };
  });

  const messages = defaultChannelMessages();
  return {
    queues,
    sectors,
    demands,
    sla: { ...QUEUE_GERAL_SLA },
    business_hours: defaultChannelBusinessHours(),
    holidays: [],
    routing: { default_queue_name: 'Geral' },
    messages,
    profiles: defaultChannelProfilesConfig(),
    operation: {
      csat_enabled: true,
      max_simultaneous_per_attendant: 5,
      inactivity_timeout_minutes: 10,
      ooh_reply_at_edge: true,
      tags: ['cadastro pendente', 'vip', 'urgente'],
    },
  };
}

/** UI do modal (revive shape). */
export function reviveUiFromOperationalPreset(
  operational: ChannelOperationalConfig
): {
  filas: Array<{
    name: string;
    setores: string[];
    capacidade: number;
    prioridade: 'baixa' | 'media' | 'alta' | 'urgente';
    transbordoPara?: string;
    slaPrimeiraResposta: number;
    slaResolucao: number;
  }>;
  setoresCfg: Array<{ id: string; name: string; demandas: string[]; isActive: boolean }>;
  filaDefault: string;
} {
  const demandasBySector = new Map<string, string[]>();
  for (const d of operational.demands) {
    for (const sid of d.sector_ids) {
      const bucket = demandasBySector.get(sid) || [];
      if (!bucket.includes(d.title)) bucket.push(d.title);
      demandasBySector.set(sid, bucket);
    }
  }
  const setoresCfg = operational.sectors.map((s) => ({
    id: s.id,
    name: s.name,
    demandas: demandasBySector.get(s.id) || [],
    isActive: s.is_active !== false,
  }));
  const nameById = new Map(operational.sectors.map((s) => [s.id, s.name]));
  const filas = operational.queues.map((q) => ({
    name: q.name,
    setores: q.sector_ids.map((id) => nameById.get(id) || id).filter(Boolean),
    capacidade: q.capacity ?? 50,
    prioridade: (q.priority === 'high' ? 'alta' : q.priority === 'low' ? 'baixa' : q.priority === 'urgent' ? 'urgente' : 'media') as
      | 'baixa'
      | 'media'
      | 'alta'
      | 'urgente',
    transbordoPara: q.overflow_queue_name,
    slaPrimeiraResposta: q.sla?.first_response_sla_minutes ?? 25,
    slaResolucao: q.sla?.resolution_sla_minutes ?? 480,
  }));
  return { filas, setoresCfg, filaDefault: operational.routing.default_queue_name || 'Geral' };
}
