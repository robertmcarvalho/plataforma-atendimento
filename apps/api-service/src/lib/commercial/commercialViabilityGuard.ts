import { supabase } from '../supabase';
import { isAtOrAfterDiagnostico, type PipelineStageLike } from './commercialStageRules';

export class LeadStageViabilityForbiddenError extends Error {
  constructor() {
    super(
      'Viabilidade disponível apenas a partir do estágio Diagnóstico. Avance o lead no funil e complete a ficha operacional.',
    );
    this.name = 'LeadStageViabilityForbiddenError';
  }
}

async function loadPipelineStages(workspaceId: string): Promise<PipelineStageLike[]> {
  const { data, error } = await supabase
    .from('commercial_pipeline_stages')
    .select('id, name, sort_order, is_won, is_lost')
    .eq('workspace_id', workspaceId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    sort_order: Number(row.sort_order),
    is_won: Boolean(row.is_won),
    is_lost: Boolean(row.is_lost),
  }));
}

export async function assertLeadStageAllowsViability(
  workspaceId: string,
  stageId: string,
): Promise<void> {
  const stages = await loadPipelineStages(workspaceId);
  if (!isAtOrAfterDiagnostico(stageId, stages)) {
    throw new LeadStageViabilityForbiddenError();
  }
}
