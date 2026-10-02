import { supabase } from './supabase';
import { ensureDreTaxRules, type DreEntityType } from './billingDreSeed';

export type DreTaxRuleRow = {
  id: string;
  entity_type: DreEntityType;
  tax_code: string;
  name: string;
  rate_pct: number;
  effective_from: string | null;
  effective_until: string | null;
  active: boolean;
};

export async function listDreTaxRules(workspaceId: string): Promise<DreTaxRuleRow[]> {
  await ensureDreTaxRules(workspaceId);
  const { data, error } = await supabase
    .from('billing_dre_tax_rules')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('entity_type')
    .order('tax_code');
  if (error) throw new Error(error.message);
  return (data || []).map((r) => ({
    id: String(r.id),
    entity_type: r.entity_type as DreEntityType,
    tax_code: String(r.tax_code),
    name: String(r.name),
    rate_pct: Number(r.rate_pct),
    effective_from: r.effective_from ? String(r.effective_from).slice(0, 10) : null,
    effective_until: r.effective_until ? String(r.effective_until).slice(0, 10) : null,
    active: Boolean(r.active),
  }));
}

export async function updateDreTaxRule(
  workspaceId: string,
  ruleId: string,
  patch: {
    rate_pct?: number;
    name?: string;
    effective_from?: string | null;
    effective_until?: string | null;
    active?: boolean;
  }
): Promise<DreTaxRuleRow> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('billing_dre_tax_rules')
    .update({ ...patch, updated_at: now })
    .eq('workspace_id', workspaceId)
    .eq('id', ruleId)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return {
    id: String(data.id),
    entity_type: data.entity_type as DreEntityType,
    tax_code: String(data.tax_code),
    name: String(data.name),
    rate_pct: Number(data.rate_pct),
    effective_from: data.effective_from ? String(data.effective_from).slice(0, 10) : null,
    effective_until: data.effective_until ? String(data.effective_until).slice(0, 10) : null,
    active: Boolean(data.active),
  };
}
