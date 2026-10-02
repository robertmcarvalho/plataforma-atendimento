import { supabase } from './supabase';
import { ensureCorporateCostCenterId } from './billingCostCenters';

export type ShareholderProLaboreRow = {
  shareholder_id: string;
  legal_name: string;
  cpf_cnpj: string | null;
  entity_type: 'coop' | 'flux';
  pro_labore_cents: number;
};

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, '0')}` };
}

function dueDateForMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, '0')}`;
}

export async function generateMonthlyCompanyPayroll(
  workspaceId: string,
  month: string,
  opts?: { include_providers?: boolean; include_shareholders?: boolean }
): Promise<{ shareholders: number; providers: number }> {
  const includeShareholders = opts?.include_shareholders !== false;
  const includeProviders = opts?.include_providers !== false;
  const dueDate = dueDateForMonth(month);
  const now = new Date().toISOString();
  let shareholders = 0;
  let providers = 0;

  if (includeShareholders) {
    const { data: rows, error } = await supabase
      .from('billing_shareholders')
      .select('id, legal_name, entity_type, pro_labore_default_cents')
      .eq('workspace_id', workspaceId)
      .eq('active', true);
    if (error) throw new Error(error.message);

    for (const sh of rows || []) {
      const amount = Number(sh.pro_labore_default_cents) || 0;
      if (amount <= 0) continue;
      const costCenterId = await ensureCorporateCostCenterId(workspaceId, sh.entity_type as 'coop' | 'flux');

      const { data: existing } = await supabase
        .from('billing_payables')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('beneficiary_type', 'shareholder')
        .eq('beneficiary_id', sh.id)
        .eq('competence_month', month)
        .eq('category', 'pro_labore')
        .maybeSingle();
      if (existing) continue;

      const { error: insErr } = await supabase.from('billing_payables').insert({
        workspace_id: workspaceId,
        beneficiary_type: 'shareholder',
        beneficiary_id: sh.id,
        legal_entity_type: sh.entity_type,
        cost_center_id: costCenterId,
        description: `Pró-labore ${month} — ${sh.legal_name}`,
        amount_cents: amount,
        due_date: dueDate,
        competence_month: month,
        category: 'pro_labore',
        status: 'draft',
        updated_at: now,
      });
      if (insErr) throw new Error(insErr.message);
      shareholders += 1;
    }
  }

  if (includeProviders) {
    const { data: rows, error } = await supabase
      .from('billing_internal_providers')
      .select('id, legal_name, default_entity, default_monthly_cents')
      .eq('workspace_id', workspaceId)
      .eq('active', true);
    if (error) throw new Error(error.message);

    for (const pr of rows || []) {
      const amount = Number(pr.default_monthly_cents) || 0;
      if (amount <= 0) continue;
      const entityType = (pr.default_entity || 'flux') as 'coop' | 'flux';
      const costCenterId = await ensureCorporateCostCenterId(workspaceId, entityType);

      const { data: existing } = await supabase
        .from('billing_payables')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('beneficiary_type', 'internal_provider')
        .eq('beneficiary_id', pr.id)
        .eq('competence_month', month)
        .eq('category', 'monthly_fee')
        .maybeSingle();
      if (existing) continue;

      const { error: insErr } = await supabase.from('billing_payables').insert({
        workspace_id: workspaceId,
        beneficiary_type: 'internal_provider',
        beneficiary_id: pr.id,
        legal_entity_type: entityType,
        cost_center_id: costCenterId,
        description: `Honorários ${month} — ${pr.legal_name}`,
        amount_cents: amount,
        due_date: dueDate,
        competence_month: month,
        category: 'monthly_fee',
        status: 'draft',
        updated_at: now,
      });
      if (insErr) throw new Error(insErr.message);
      providers += 1;
    }
  }

  return { shareholders, providers };
}

export async function buildShareholderProLaboreInssReport(
  workspaceId: string,
  month: string
): Promise<{ rows: ShareholderProLaboreRow[]; total_cents: number }> {
  const { data: payables, error } = await supabase
    .from('billing_payables')
    .select('beneficiary_id, amount_cents, legal_entity_type')
    .eq('workspace_id', workspaceId)
    .eq('beneficiary_type', 'shareholder')
    .eq('category', 'pro_labore')
    .eq('competence_month', month)
    .not('status', 'eq', 'cancelled');
  if (error) throw new Error(error.message);

  const byShareholder = new Map<string, { cents: number; entity_type: string }>();
  for (const p of payables || []) {
    const id = String(p.beneficiary_id);
    const cur = byShareholder.get(id) || { cents: 0, entity_type: String(p.legal_entity_type || 'coop') };
    cur.cents += Number(p.amount_cents) || 0;
    byShareholder.set(id, cur);
  }

  const ids = [...byShareholder.keys()].filter((id) => (byShareholder.get(id)?.cents || 0) > 0);
  if (!ids.length) return { rows: [], total_cents: 0 };

  const { data: shareholders, error: shErr } = await supabase
    .from('billing_shareholders')
    .select('id, legal_name, cpf_cnpj, entity_type, contract_started_at, inactive_at')
    .eq('workspace_id', workspaceId)
    .in('id', ids);
  if (shErr) throw new Error(shErr.message);

  const rows: ShareholderProLaboreRow[] = (shareholders || [])
    .map((sh) => ({
      shareholder_id: String(sh.id),
      legal_name: String(sh.legal_name),
      cpf_cnpj: sh.cpf_cnpj ? String(sh.cpf_cnpj) : null,
      entity_type: (sh.entity_type as 'coop' | 'flux') || 'coop',
      pro_labore_cents: byShareholder.get(String(sh.id))?.cents || 0,
    }))
    .filter((r) => r.pro_labore_cents > 0)
    .sort((a, b) => a.legal_name.localeCompare(b.legal_name, 'pt-BR'));

  const total_cents = rows.reduce((s, r) => s + r.pro_labore_cents, 0);
  return { rows, total_cents };
}
