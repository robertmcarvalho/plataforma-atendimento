import type { CommercialLead, CommercialStage, LeadTemperature } from '@/lib/commercial/types';

/** Dias no mesmo estágio sem ganho/perda — alinhado ao blueprint (alerta deal estagnado). */
export const STAGNANT_STAGE_DAYS = 14;

/**
 * Temperatura derivada — alinhada com apps/api-service/src/lib/commercial/scoring.ts
 */
export function deriveLeadTemperature(
  lead: CommercialLead,
  stage?: CommercialStage,
): LeadTemperature | null {
  if (stage && isTerminalStage(stage)) return null;
  if (lead.tags?.includes('retorno-urgente')) return 'urgente';
  if (!lead.ai_score_set_at) return null;

  const persisted = lead.lead_temperature;
  if (persisted && ['frio', 'morno', 'quente', 'urgente'].includes(persisted)) {
    return persisted;
  }

  if (typeof lead.ai_score === 'number') {
    const score = lead.ai_score;
    const hoursSinceMsg = lead.last_message_at
      ? (Date.now() - new Date(lead.last_message_at).getTime()) / 3600000
      : Number.POSITIVE_INFINITY;
    if (score >= 82 || (score >= 70 && hoursSinceMsg < 24)) return 'quente';
    if (score >= 50) return 'morno';
    return 'frio';
  }

  return null;
}

export function isLeadScoringPending(lead: CommercialLead): boolean {
  return !lead.ai_score_set_at;
}

export function hasPersistedAiScore(lead: CommercialLead): boolean {
  return Boolean(lead.ai_score_set_at) && typeof lead.ai_score === 'number';
}

export function deriveLeadTemperatureWithStages(
  lead: CommercialLead,
  stages: CommercialStage[],
): LeadTemperature | null {
  return deriveLeadTemperature(lead, stages.find((s) => s.id === lead.stage_id));
}

export function isTerminalStage(stage: CommercialStage | undefined) {
  return Boolean(stage?.is_won || stage?.is_lost);
}

export function isStagnantLead(lead: CommercialLead, stages: CommercialStage[]): boolean {
  const stage = stages.find((s) => s.id === lead.stage_id);
  if (isTerminalStage(stage)) return false;
  const days = (Date.now() - new Date(lead.updated_at).getTime()) / 86400000;
  return days >= STAGNANT_STAGE_DAYS;
}

export function listStagnantLeads(leads: CommercialLead[], stages: CommercialStage[]): CommercialLead[] {
  return leads.filter((l) => isStagnantLead(l, stages));
}

export function pipelineWeightedValueCents(leads: CommercialLead[], stages: CommercialStage[]): number {
  return leads.reduce((sum, lead) => {
    const stage = stages.find((s) => s.id === lead.stage_id);
    if (isTerminalStage(stage) || !lead.deal_value_cents) return sum;
    const prob = (stage?.probability ?? 0) / 100;
    return sum + Math.round(lead.deal_value_cents * prob);
  }, 0);
}
