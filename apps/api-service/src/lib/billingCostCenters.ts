import { supabase } from './supabase';

export type BillingEntityType = 'coop' | 'flux';

const CORPORATE_CENTER_META: Record<BillingEntityType, { name: string; code: string; coopPct: number; fluxPct: number }> = {
  coop: { name: 'Cooperativa', code: 'COOP', coopPct: 100, fluxPct: 0 },
  flux: { name: 'Flux Farma', code: 'FLUX', coopPct: 0, fluxPct: 100 },
};

export async function ensureCorporateCostCenterId(workspaceId: string, entityType: BillingEntityType): Promise<string | null> {
  const meta = CORPORATE_CENTER_META[entityType];

  const { data: existing, error: loadErr } = await supabase
    .from('billing_cost_centers')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('corporate_entity_type', entityType)
    .maybeSingle();
  if (loadErr) throw new Error(loadErr.message);
  if (existing?.id) return String(existing.id);

  const { data, error } = await supabase
    .from('billing_cost_centers')
    .upsert(
      {
        workspace_id: workspaceId,
        name: meta.name,
        code: meta.code,
        split_coop_pct: meta.coopPct,
        split_flux_pct: meta.fluxPct,
        active: true,
        corporate_entity_type: entityType,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,name' }
    )
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data?.id ? String(data.id) : null;
}
