/**
 * Preset: 4 setores macro + filas Geral / Especializada + demandas + SLA.
 * Alinhado a guidedIntake.ts e workspaceCatalogDefaults.ts.
 */

export const MACRO_SECTOR_NAMES = [
  'Operacional',
  'Atendimento Geral',
  'Financeiro',
  'Suporte Técnico',
];

/** SLA base (minutos) — dentro do horário comercial. */
export const SLA_ACTIONS = {
  first_response_action: 'alert_attendant',
  treatment_action: 'alert_and_reassign',
  resolution_action: 'escalate_supervisor',
  use_business_hours: true,
  business_hours_id: 'default',
};

export const QUEUE_PRESETS = {
  Geral: {
    name: 'Geral',
    sectorNames: ['Operacional', 'Atendimento Geral'],
    capacity: 80,
    priority: 'medium',
    sla: {
      ...SLA_ACTIONS,
      first_response_sla_minutes: 25,
      treatment_sla_minutes: 120,
      resolution_sla_minutes: 480,
    },
    description: 'Rotina operacional e dúvidas gerais (MEI, benefícios, conduta).',
  },
  Especializada: {
    name: 'Especializada',
    sectorNames: ['Financeiro', 'Suporte Técnico'],
    capacity: 40,
    priority: 'high',
    overflow_queue_name: 'Geral',
    sla: {
      ...SLA_ACTIONS,
      first_response_sla_minutes: 15,
      treatment_sla_minutes: 75,
      resolution_sla_minutes: 300,
    },
    description: 'Pagamentos, repasses, contestações e incidentes de plataforma/app.',
  },
};

/** Demandas por sector_key (workspace catalog) → nome do setor no banco. */
export const DEMAND_CATALOG = [
  { profile: 'driver', sectorKey: 'operacional', demandKey: 'drv-op-cadastro', title: 'Dados cadastrais (PIX, telefone, e-mail)' },
  { profile: 'driver', sectorKey: 'atendimento-geral', demandKey: 'drv-ag-mei', title: 'MEI — abertura e obrigações' },
  { profile: 'driver', sectorKey: 'atendimento-geral', demandKey: 'drv-ag-cert', title: 'Certificado digital (e-CPF / ICP-Brasil)' },
  { profile: 'driver', sectorKey: 'atendimento-geral', demandKey: 'drv-ag-benef', title: 'Benefícios e vales' },
  { profile: 'driver', sectorKey: 'atendimento-geral', demandKey: 'drv-ag-comp', title: 'Comprovantes e declarações (IR, extrato)' },
  { profile: 'driver', sectorKey: 'financeiro', demandKey: 'drv-fin-pag', title: 'Pagamento / repasse não recebido' },
  { profile: 'driver', sectorKey: 'financeiro', demandKey: 'drv-fin-desc', title: 'Contestação de desconto na corrida' },
  { profile: 'driver', sectorKey: 'financeiro', demandKey: 'drv-fin-adv', title: 'Adiantamento de valores' },
  { profile: 'driver', sectorKey: 'suporte-tecnico', demandKey: 'drv-tech-app', title: 'App do entregador (login, erro, travamento)' },
  { profile: 'pharmacy', sectorKey: 'operacional', demandKey: 'ph-op-escala', title: 'Escala / quadro / plantão' },
  { profile: 'pharmacy', sectorKey: 'operacional', demandKey: 'ph-op-falta', title: 'Falta de entregador na loja' },
  { profile: 'pharmacy', sectorKey: 'operacional', demandKey: 'ph-op-atraso', title: 'Atraso na coleta ou saída' },
  { profile: 'pharmacy', sectorKey: 'operacional', demandKey: 'ph-op-cob', title: 'Cobertura / substituição de entregador' },
  { profile: 'pharmacy', sectorKey: 'atendimento-geral', demandKey: 'ph-ag-cond', title: 'Conduta do entregador (reclamação)' },
  { profile: 'pharmacy', sectorKey: 'financeiro', demandKey: 'ph-fin-fat', title: 'Fatura / repasse à farmácia' },
  { profile: 'pharmacy', sectorKey: 'financeiro', demandKey: 'ph-fin-cont', title: 'Contestação de cobrança ou valor' },
  { profile: 'pharmacy', sectorKey: 'suporte-tecnico', demandKey: 'ph-tech-lenta', title: 'Plataforma lenta ou indisponível' },
  { profile: 'pharmacy', sectorKey: 'suporte-tecnico', demandKey: 'ph-tech-duv', title: 'Como usar a plataforma de gestão' },
  { profile: 'pharmacy', sectorKey: 'suporte-tecnico', demandKey: 'ph-tech-bug', title: 'Erro ou falha na gestão de entregas' },
];

const SECTOR_KEY_TO_NAME = {
  operacional: 'Operacional',
  'atendimento-geral': 'Atendimento Geral',
  financeiro: 'Financeiro',
  'suporte-tecnico': 'Suporte Técnico',
};

function slaOverrideForDemandKey(demandKey) {
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

export function defaultBusinessHours() {
  const open = { is_open: true, start: '08:00', end: '18:00' };
  const closed = { is_open: false, start: '08:00', end: '12:00' };
  return {
    timezone: 'America/Sao_Paulo',
    weekly: {
      sunday: closed,
      monday: open,
      tuesday: open,
      wednesday: open,
      thursday: open,
      friday: open,
      saturday: { is_open: true, start: '08:00', end: '12:00' },
    },
  };
}

/**
 * @param {Record<string, string>} sectorIdByName — nome exato → UUID (tabela sectors)
 */
export function buildChannelOperationalConfig(sectorIdByName) {
  const sectors = MACRO_SECTOR_NAMES.map((name) => ({
    id: sectorIdByName[name],
    name,
    is_active: true,
    escalation_manager_id: null,
    escalation_manager_name: null,
  })).filter((s) => s.id);

  const queues = Object.values(QUEUE_PRESETS).map((q) => ({
    name: q.name,
    sector_ids: q.sectorNames.map((n) => sectorIdByName[n]).filter(Boolean),
    capacity: q.capacity,
    priority: q.priority,
    overflow_queue_name: q.overflow_queue_name,
    sla: { ...q.sla },
  }));

  const demands = DEMAND_CATALOG.map((row, index) => {
    const sectorName = SECTOR_KEY_TO_NAME[row.sectorKey];
    const sectorId = sectorIdByName[sectorName];
    const override = slaOverrideForDemandKey(row.demandKey);
    return {
      id: row.demandKey,
      title: row.title,
      sector_ids: sectorId ? [sectorId] : [],
      is_active: true,
      requires_pharmacy: row.profile === 'driver',
      route_to: null,
      target_sector_id: null,
      target_queue_name: null,
      target_attendant_id: null,
      sla_override: override ? { ...SLA_ACTIONS, ...override } : null,
      sort_order: index + 1,
    };
  }).filter((d) => d.sector_ids.length > 0);

  return {
    queues,
    sectors,
    demands,
    sla: { ...QUEUE_PRESETS.Geral.sla },
    business_hours: defaultBusinessHours(),
    holidays: [],
    routing: { default_queue_name: 'Geral' },
    messages: {
      greeting: 'Olá! Como posso te ajudar? Toque em Ver setores e escolha o tipo de atendimento:',
      out_of_hours:
        'Obrigado pelo contato. No momento estamos fora do horário de atendimento. Retornaremos no próximo período útil.',
      queue_full: 'No momento todas as posições de atendimento estão ocupadas. Você será atendido em breve.',
      closing: 'Obrigado pelo contato. Se precisar de algo mais, é só enviar uma mensagem.',
      csat: 'Como você avalia o atendimento? (1 a 5)',
      intake: {},
    },
    profiles: {
      accepted: ['entregador', 'farmacia', 'lider'],
      pre_registration_fields: {
        entregador: ['Nome', 'CPF/CNPJ', 'Telefone'],
        farmacia: ['Razão Social', 'Cidade', 'E-mail'],
        lider: ['Nome', 'Cargo', 'E-mail'],
      },
    },
    operation: {
      csat_enabled: true,
      max_simultaneous_per_attendant: 5,
      inactivity_timeout_minutes: 10,
      ooh_reply_at_edge: true,
      tags: ['cadastro pendente', 'vip', 'urgente'],
    },
  };
}

export function printPresetSummary(sectorIdByName) {
  console.log('\n--- Setores (banco) ---');
  for (const name of MACRO_SECTOR_NAMES) {
    console.log(`  ${name}: ${sectorIdByName[name] || '(não criado)'}`);
  }
  console.log('\n--- Filas (canal WhatsApp) ---');
  for (const q of Object.values(QUEUE_PRESETS)) {
    const sla = q.sla;
    console.log(`  ${q.name}: setores [${q.sectorNames.join(', ')}]`);
    console.log(
      `    SLA: 1ª resposta ${sla.first_response_sla_minutes}m · tratamento ${sla.treatment_sla_minutes}m · resolução ${sla.resolution_sla_minutes}m`
    );
    if (q.overflow_queue_name) console.log(`    Transbordo → ${q.overflow_queue_name}`);
  }
  console.log(`\n  Roteamento padrão: fila "${QUEUE_PRESETS.Geral.name}"`);
  console.log(`  Demandas no canal: ${DEMAND_CATALOG.length} itens\n`);
}
