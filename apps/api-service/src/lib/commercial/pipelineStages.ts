import { supabase } from '../supabase';
import { DEFAULT_LOSS_REASONS, DEFAULT_PIPELINE_STAGES, DEFAULT_FIELD_DEFINITIONS, DEFAULT_ERP_OPTIONS } from './defaultSeed';
import { ensureCommercialRoles } from './commercialRoles';

export async function ensureCommercialDefaults(workspaceId: string) {
  await ensureCommercialRoles(workspaceId);
  const { count: stageCount } = await supabase
    .from('commercial_pipeline_stages')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);

  if (!stageCount) {
    await supabase.from('commercial_pipeline_stages').insert(
      DEFAULT_PIPELINE_STAGES.map((s) => ({ workspace_id: workspaceId, ...s })),
    );
  }

  const { count: lossCount } = await supabase
    .from('commercial_loss_reasons')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);

  if (!lossCount) {
    await supabase.from('commercial_loss_reasons').insert(
      DEFAULT_LOSS_REASONS.map((r) => ({ workspace_id: workspaceId, active: true, ...r })),
    );
  }

  const { count: fieldCount } = await supabase
    .from('commercial_field_definitions')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);

  if (!fieldCount) {
    await supabase.from('commercial_field_definitions').insert(
      DEFAULT_FIELD_DEFINITIONS.map((f) => ({
        workspace_id: workspaceId,
        slug: f.slug,
        label: f.label,
        field_type: f.field_type,
        required: f.required,
        options: f.options,
        sort_order: f.sort_order,
      })),
    );
  }

  const { count: erpCount } = await supabase
    .from('commercial_erp_options')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);

  if (!erpCount) {
    await supabase.from('commercial_erp_options').insert(
      DEFAULT_ERP_OPTIONS.map((r) => ({ workspace_id: workspaceId, active: true, ...r })),
    );
  }
}

export async function getEntryStageId(workspaceId: string): Promise<string | null> {
  const { data } = await supabase
    .from('commercial_pipeline_stages')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('is_entry', true)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

export async function getTerminalStageId(workspaceId: string, kind: 'won' | 'lost'): Promise<string | null> {
  const col = kind === 'won' ? 'is_won' : 'is_lost';
  const { data } = await supabase
    .from('commercial_pipeline_stages')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq(col, true)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

export async function getStageById(workspaceId: string, stageId: string) {
  const { data, error } = await supabase
    .from('commercial_pipeline_stages')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', stageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
