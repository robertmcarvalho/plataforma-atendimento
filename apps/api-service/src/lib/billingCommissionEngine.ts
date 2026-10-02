import { supabase } from './supabase';

export type CommissionReportRow = {
  accrual_id: string;
  partner_id: string;
  partner_name: string;
  commission_role: 'sales_agent' | 'referrer';
  commercial_lead_id: string;
  lead_trade_name: string;
  pharmacy_id: string | null;
  competence_month: string;
  amount_cents: number;
  deal_value_cents: number | null;
  status: string;
  payable_id: string | null;
  converted_at: string | null;
};

type CommissionRole = 'sales_agent' | 'referrer';

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${month}-${String(lastDay).padStart(2, '0')}T23:59:59.999Z`;
  return { start: `${month}-01T00:00:00.000Z`, end };
}

function dueDateForMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const payMonth = m === 12 ? 1 : m + 1;
  const payYear = m === 12 ? y + 1 : y;
  return `${payYear}-${String(payMonth).padStart(2, '0')}-15`;
}

function isRuleEffective(rule: { effective_from?: string | null; effective_until?: string | null }, at: Date): boolean {
  if (rule.effective_from) {
    const from = new Date(`${rule.effective_from}T00:00:00.000Z`);
    if (at < from) return false;
  }
  if (rule.effective_until) {
    const until = new Date(`${rule.effective_until}T23:59:59.999Z`);
    if (at > until) return false;
  }
  return true;
}

function calculateAmount(
  basis: string,
  dealValueCents: number,
  percentValue: number | null,
  fixedCents: number | null
): number {
  if (basis === 'fixed_per_conversion') {
    return Math.max(0, Math.round(Number(fixedCents) || 0));
  }
  const pct = Number(percentValue) || 0;
  return Math.max(0, Math.round((dealValueCents * pct) / 100));
}

async function loadActiveRule(workspaceId: string, partnerId: string, role: CommissionRole, at: Date) {
  const { data, error } = await supabase
    .from('billing_commission_rules')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('partner_id', partnerId)
    .eq('role_type', role)
    .eq('active', true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !isRuleEffective(data, at)) return null;
  return data;
}

export async function accrueCommissionsForMonth(
  workspaceId: string,
  month: string
): Promise<{ created: number; skipped: number }> {
  const { start, end } = monthBounds(month);
  const now = new Date().toISOString();

  const { data: wonActivities, error: actErr } = await supabase
    .from('commercial_lead_activities')
    .select('lead_id, created_at')
    .eq('workspace_id', workspaceId)
    .eq('activity_type', 'won')
    .gte('created_at', start)
    .lte('created_at', end);
  if (actErr) throw new Error(actErr.message);

  const leadIds = [...new Set((wonActivities || []).map((a) => String(a.lead_id)))];
  if (!leadIds.length) return { created: 0, skipped: 0 };

  const convertedAtByLead = new Map<string, string>();
  for (const a of wonActivities || []) {
    const id = String(a.lead_id);
    const cur = convertedAtByLead.get(id);
    const ts = String(a.created_at);
    if (!cur || ts > cur) convertedAtByLead.set(id, ts);
  }

  const { data: leads, error: leadErr } = await supabase
    .from('commercial_leads')
    .select('id, trade_name, deal_value_cents, converted_pharmacy_id, sales_partner_id, referrer_partner_id')
    .eq('workspace_id', workspaceId)
    .in('id', leadIds)
    .not('converted_pharmacy_id', 'is', null);
  if (leadErr) throw new Error(leadErr.message);

  let created = 0;
  let skipped = 0;

  for (const lead of leads || []) {
    const leadId = String(lead.id);
    const convertedAt = convertedAtByLead.get(leadId) || now;
    const convertedDate = new Date(convertedAt);
    const dealValue = Number(lead.deal_value_cents) || 0;

    const roles: { role: CommissionRole; partnerId: string | null }[] = [
      { role: 'sales_agent', partnerId: lead.sales_partner_id ? String(lead.sales_partner_id) : null },
      { role: 'referrer', partnerId: lead.referrer_partner_id ? String(lead.referrer_partner_id) : null },
    ];

    for (const { role, partnerId } of roles) {
      if (!partnerId) {
        skipped += 1;
        continue;
      }

      const { data: existing } = await supabase
        .from('billing_commission_accruals')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('commercial_lead_id', leadId)
        .eq('commission_role', role)
        .maybeSingle();
      if (existing) {
        skipped += 1;
        continue;
      }

      const rule = await loadActiveRule(workspaceId, partnerId, role, convertedDate);
      if (!rule) {
        skipped += 1;
        continue;
      }

      const amount = calculateAmount(
        String(rule.calculation_basis),
        dealValue,
        rule.percent_value != null ? Number(rule.percent_value) : null,
        rule.fixed_cents != null ? Number(rule.fixed_cents) : null
      );
      if (amount <= 0) {
        skipped += 1;
        continue;
      }

      const { error: insErr } = await supabase.from('billing_commission_accruals').insert({
        workspace_id: workspaceId,
        partner_id: partnerId,
        commercial_lead_id: leadId,
        pharmacy_id: lead.converted_pharmacy_id,
        commission_role: role,
        rule_id: rule.id,
        competence_month: month,
        amount_cents: amount,
        deal_value_cents: dealValue || null,
        status: 'draft',
        converted_at: convertedAt,
        updated_at: now,
      });
      if (insErr) throw new Error(insErr.message);
      created += 1;
    }
  }

  return { created, skipped };
}

export async function generateCommissionPayables(
  workspaceId: string,
  month: string
): Promise<{ payables: number; accruals_linked: number }> {
  const dueDate = dueDateForMonth(month);
  const now = new Date().toISOString();

  const { data: accruals, error } = await supabase
    .from('billing_commission_accruals')
    .select('id, partner_id, amount_cents, payable_id, status')
    .eq('workspace_id', workspaceId)
    .eq('competence_month', month)
    .is('payable_id', null)
    .in('status', ['draft', 'approved']);
  if (error) throw new Error(error.message);

  const byPartner = new Map<string, { cents: number; ids: string[] }>();
  for (const a of accruals || []) {
    if (a.status === 'cancelled') continue;
    const pid = String(a.partner_id);
    const cur = byPartner.get(pid) || { cents: 0, ids: [] };
    cur.cents += Number(a.amount_cents) || 0;
    cur.ids.push(String(a.id));
    byPartner.set(pid, cur);
  }

  let payables = 0;
  let accrualsLinked = 0;

  for (const [partnerId, agg] of byPartner) {
    if (agg.cents <= 0) continue;

    const { data: partner, error: pErr } = await supabase
      .from('billing_commercial_partners')
      .select('id, legal_name, default_entity, active')
      .eq('workspace_id', workspaceId)
      .eq('id', partnerId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!partner?.active) continue;

    const { data: existing } = await supabase
      .from('billing_payables')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('beneficiary_type', 'commercial_partner')
      .eq('beneficiary_id', partnerId)
      .eq('competence_month', month)
      .eq('category', 'commission')
      .maybeSingle();
    if (existing) continue;

    const { data: payable, error: payErr } = await supabase
      .from('billing_payables')
      .insert({
        workspace_id: workspaceId,
        beneficiary_type: 'commercial_partner',
        beneficiary_id: partnerId,
        legal_entity_type: partner.default_entity || 'coop',
        description: `Comissão ${month} — ${partner.legal_name}`,
        amount_cents: agg.cents,
        due_date: dueDate,
        competence_month: month,
        category: 'commission',
        status: 'draft',
        updated_at: now,
      })
      .select('id')
      .single();
    if (payErr) throw new Error(payErr.message);

    const { error: linkErr } = await supabase
      .from('billing_commission_accruals')
      .update({ payable_id: payable.id, status: 'approved', updated_at: now })
      .eq('workspace_id', workspaceId)
      .in('id', agg.ids);
    if (linkErr) throw new Error(linkErr.message);

    payables += 1;
    accrualsLinked += agg.ids.length;
  }

  return { payables, accruals_linked: accrualsLinked };
}

export async function buildCommissionReport(
  workspaceId: string,
  month: string
): Promise<{ rows: CommissionReportRow[]; total_cents: number }> {
  const { data: accruals, error } = await supabase
    .from('billing_commission_accruals')
    .select(
      'id, partner_id, commission_role, commercial_lead_id, pharmacy_id, competence_month, amount_cents, deal_value_cents, status, payable_id, converted_at, partner:billing_commercial_partners!partner_id(legal_name), lead:commercial_leads!commercial_lead_id(trade_name)'
    )
    .eq('workspace_id', workspaceId)
    .eq('competence_month', month)
    .neq('status', 'cancelled')
    .order('partner_id');
  if (error) throw new Error(error.message);

  const rows: CommissionReportRow[] = (accruals || []).map((a) => {
    const partner = a.partner as { legal_name?: string } | null;
    const lead = a.lead as { trade_name?: string } | null;
    return {
      accrual_id: String(a.id),
      partner_id: String(a.partner_id),
      partner_name: String(partner?.legal_name || '—'),
      commission_role: a.commission_role as CommissionRole,
      commercial_lead_id: String(a.commercial_lead_id),
      lead_trade_name: String(lead?.trade_name || '—'),
      pharmacy_id: a.pharmacy_id ? String(a.pharmacy_id) : null,
      competence_month: String(a.competence_month),
      amount_cents: Number(a.amount_cents) || 0,
      deal_value_cents: a.deal_value_cents != null ? Number(a.deal_value_cents) : null,
      status: String(a.status),
      payable_id: a.payable_id ? String(a.payable_id) : null,
      converted_at: a.converted_at ? String(a.converted_at) : null,
    };
  });

  rows.sort((a, b) => a.partner_name.localeCompare(b.partner_name, 'pt-BR') || a.lead_trade_name.localeCompare(b.lead_trade_name, 'pt-BR'));
  const total_cents = rows.reduce((s, r) => s + r.amount_cents, 0);
  return { rows, total_cents };
}
