/**
 * Triagem guiada (perfil → setor → demanda): dados estáticos alinhados ao documento de negócio.
 * Setores macro: Operacional, Atendimento Geral, Financeiro, Suporte Técnico.
 *
 * Líder: após setor (e farmácia se N>1), o runtime encaminha sem lista de “demanda” (ver `guided_macro_menu`).
 * Entregador / farmácia: títulos abaixo aparecem nas listas WhatsApp do wizard — manter linhas curtas.
 */

export type GuidedDemandProfile = 'driver' | 'pharmacy';

const QA_SLA_BASE = {
  first_response_action: 'alert_attendant',
  treatment_action: 'alert_and_reassign',
  resolution_action: 'escalate_supervisor',
  use_business_hours: true,
  business_hours_id: 'default',
  business_hours_label: 'Padrão · seg-sex 08h-18h',
} as const;

/** SLA alinhado aos presets do Flow Principal (ordem de grandeza). */
export function slaPresetForDemand(_profile: GuidedDemandProfile, demandId: string): Record<string, unknown> {
  if (demandId === 'ldr-setor') {
    return {
      ...QA_SLA_BASE,
      first_response_sla_minutes: 25,
      treatment_sla_minutes: 120,
      resolution_sla_minutes: 480,
    };
  }
  if (demandId.includes('fin-') || demandId.includes('ph-fin-')) {
    return {
      ...QA_SLA_BASE,
      first_response_sla_minutes: 15,
      treatment_sla_minutes: 90,
      resolution_sla_minutes: 360,
    };
  }
  if (demandId.includes('tech') || demandId.includes('ph-tech')) {
    return {
      ...QA_SLA_BASE,
      first_response_sla_minutes: 15,
      treatment_sla_minutes: 60,
      resolution_sla_minutes: 240,
    };
  }
  if (demandId.includes('crit')) {
    return {
      ...QA_SLA_BASE,
      first_response_sla_minutes: 10,
      treatment_sla_minutes: 45,
      resolution_sla_minutes: 180,
    };
  }
  if (demandId.includes('benef')) {
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

export function normalizeMacroSectorName(name: string): string {
  const n = String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  if (n.includes('operacional')) return 'operacional';
  if (n.includes('atendimento') && n.includes('geral')) return 'atendimento geral';
  if (n.includes('financeiro')) return 'financeiro';
  if (n.includes('suporte')) return 'suporte tecnico';
  return n;
}

export type DemandRow = { id: string; title: string };

const DRIVER_DEMANDS: Record<string, DemandRow[]> = {
  operacional: [{ id: 'drv-op-cadastro', title: 'Dados cadastrais (PIX, telefone, e-mail)' }],
  'atendimento geral': [
    { id: 'drv-ag-mei', title: 'MEI — abertura e obrigações' },
    { id: 'drv-ag-cert', title: 'Certificado digital (e-CPF / ICP-Brasil)' },
    { id: 'drv-ag-benef', title: 'Benefícios e vales' },
    { id: 'drv-ag-comp', title: 'Comprovantes e declarações (IR, extrato)' },
  ],
  financeiro: [
    { id: 'drv-fin-pag', title: 'Pagamento / repasse não recebido' },
    { id: 'drv-fin-desc', title: 'Contestação de desconto na corrida' },
    { id: 'drv-fin-adv', title: 'Adiantamento de valores' },
  ],
  'suporte tecnico': [{ id: 'drv-tech-app', title: 'App do entregador (login, erro, travamento)' }],
};

const PHARMACY_DEMANDS: Record<string, DemandRow[]> = {
  operacional: [
    { id: 'ph-op-escala', title: 'Escala / quadro / plantão' },
    { id: 'ph-op-falta', title: 'Falta de entregador na loja' },
    { id: 'ph-op-atraso', title: 'Atraso na coleta ou saída' },
    { id: 'ph-op-cob', title: 'Cobertura / substituição de entregador' },
  ],
  'atendimento geral': [{ id: 'ph-ag-cond', title: 'Conduta do entregador (reclamação)' }],
  financeiro: [
    { id: 'ph-fin-fat', title: 'Fatura / repasse à farmácia' },
    { id: 'ph-fin-cont', title: 'Contestação de cobrança ou valor' },
  ],
  'suporte tecnico': [
    { id: 'ph-tech-lenta', title: 'Plataforma lenta ou indisponível' },
    { id: 'ph-tech-duv', title: 'Como usar a plataforma de gestão' },
    { id: 'ph-tech-bug', title: 'Erro ou falha na gestão de entregas' },
  ],
};

export function listDemandsForSector(profile: GuidedDemandProfile, sectorDisplayName: string): DemandRow[] {
  const key = normalizeMacroSectorName(sectorDisplayName);
  const map = profile === 'driver' ? DRIVER_DEMANDS : PHARMACY_DEMANDS;
  return map[key] || [];
}
