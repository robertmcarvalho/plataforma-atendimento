/**
 * Temperatura de lead — fonte única (API + referência para frontend).
 * Score IA só existe após persistência Gemini (ai_score_set_at).
 */

export type LeadTemperature = 'frio' | 'morno' | 'quente' | 'urgente';

export type LeadScoringInput = {
  ai_score?: number | null;
  ai_score_set_at?: string | null;
  ai_score_explanation?: string | null;
  lead_temperature?: string | null;
  last_message_at?: string | null;
  updated_at?: string | null;
  tags?: string[] | null;
  stage_is_won?: boolean;
  stage_is_lost?: boolean;
};

export type LeadScoringResult = {
  status: 'ready' | 'pending';
  is_pending: boolean;
  ai_score: number | null;
  lead_temperature: LeadTemperature | null;
  explanation: string | null;
  stagnant_days: number;
  is_stagnant: boolean;
};

export function deriveLeadTemperature(input: LeadScoringInput): LeadTemperature | null {
  if (input.stage_is_won || input.stage_is_lost) return null;
  if (input.tags?.includes('retorno-urgente')) return 'urgente';
  if (!input.ai_score_set_at) return null;

  const persisted = input.lead_temperature as LeadTemperature | null | undefined;
  if (persisted && ['frio', 'morno', 'quente', 'urgente'].includes(persisted)) {
    return persisted;
  }

  if (typeof input.ai_score === 'number') {
    const score = input.ai_score;
    const hoursSinceMsg = input.last_message_at
      ? (Date.now() - new Date(input.last_message_at).getTime()) / 3600000
      : Number.POSITIVE_INFINITY;
    if (score >= 82 || (score >= 70 && hoursSinceMsg < 24)) return 'quente';
    if (score >= 50) return 'morno';
    return 'frio';
  }

  return null;
}

function stagnantMeta(input: LeadScoringInput) {
  const ref = input.last_message_at || input.updated_at;
  const stagnantDays = ref ? Math.floor((Date.now() - new Date(ref).getTime()) / 86400000) : 0;
  const isStagnant = !input.stage_is_lost && !input.stage_is_won && stagnantDays >= 14;
  return { stagnantDays, isStagnant };
}

export function buildLeadScoringResponse(input: LeadScoringInput): LeadScoringResult {
  const { stagnantDays, isStagnant } = stagnantMeta(input);
  const hasPersistedScore = Boolean(input.ai_score_set_at) && typeof input.ai_score === 'number';

  if (!hasPersistedScore) {
    return {
      status: 'pending',
      is_pending: true,
      ai_score: null,
      lead_temperature: null,
      explanation: isStagnant
        ? `Sem movimentação há ${stagnantDays} dias — priorize contato.`
        : null,
      stagnant_days: stagnantDays,
      is_stagnant: isStagnant,
    };
  }

  const temperature = deriveLeadTemperature(input);
  const explanation =
    input.ai_score_explanation?.trim() ||
    (isStagnant ? `Sem movimentação há ${stagnantDays} dias — priorize contato.` : null);

  return {
    status: 'ready',
    is_pending: false,
    ai_score: input.ai_score ?? null,
    lead_temperature: temperature,
    explanation,
    stagnant_days: stagnantDays,
    is_stagnant: isStagnant,
  };
}

/** @deprecated use buildLeadScoringResponse — mantido para imports legados sem score mock */
export function deriveLeadScoring(input: LeadScoringInput): LeadScoringResult {
  return buildLeadScoringResponse(input);
}
