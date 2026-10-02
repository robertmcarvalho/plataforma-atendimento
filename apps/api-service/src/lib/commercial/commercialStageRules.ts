/** Regras de estágio do funil comercial (viabilidade a partir de Diagnóstico). */

export type PipelineStageLike = {
  id: string;
  name: string;
  sort_order: number;
  is_won?: boolean;
  is_lost?: boolean;
};

export const LEAD_DETAIL_TABS = ['Resumo', 'Conversa', 'Atividades', 'Proposta', 'Viabilidade'] as const;
export type LeadDetailTab = (typeof LEAD_DETAIL_TABS)[number];

const VIABILITY_TAB: LeadDetailTab = 'Viabilidade';

function normalizeStageName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
}

export function findDiagnosticoStage(stages: PipelineStageLike[]): PipelineStageLike | null {
  const sorted = [...stages].sort((a, b) => a.sort_order - b.sort_order);
  const byName = sorted.find((s) => normalizeStageName(s.name).includes('diagnostico'));
  if (byName) return byName;
  const fallback = sorted.find((s) => !s.is_won && !s.is_lost && s.sort_order >= 4);
  return fallback ?? null;
}

export function getStageSortOrder(stages: PipelineStageLike[], stageId: string): number | null {
  const stage = stages.find((s) => s.id === stageId);
  return stage != null ? stage.sort_order : null;
}

export function isAtOrAfterDiagnostico(
  leadStageId: string,
  stages: PipelineStageLike[],
): boolean {
  const diagnostico = findDiagnosticoStage(stages);
  if (!diagnostico) return false;
  const currentOrder = getStageSortOrder(stages, leadStageId);
  if (currentOrder == null) return false;
  return currentOrder >= diagnostico.sort_order;
}

export function visibleTabsForLead(
  leadStageId: string,
  stages: PipelineStageLike[],
  options?: { proposalsEnabled?: boolean },
): LeadDetailTab[] {
  const proposalsEnabled = options?.proposalsEnabled !== false;
  let tabs: LeadDetailTab[];
  if (isAtOrAfterDiagnostico(leadStageId, stages)) {
    tabs = [...LEAD_DETAIL_TABS];
  } else {
    tabs = LEAD_DETAIL_TABS.filter((t) => t !== VIABILITY_TAB);
  }
  if (!proposalsEnabled) {
    tabs = tabs.filter((t) => t !== 'Proposta');
  }
  return tabs;
}

export function canAccessViabilityActions(leadStageId: string, stages: PipelineStageLike[]): boolean {
  return isAtOrAfterDiagnostico(leadStageId, stages);
}
