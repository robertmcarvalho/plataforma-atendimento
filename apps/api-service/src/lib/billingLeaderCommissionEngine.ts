import { supabase } from './supabase';

export type LeaderCommissionReportRow = {
  accrual_id: string;
  leader_id: string;
  leader_name: string;
  pharmacy_id: string;
  pharmacy_name: string;
  competence_month: string;
  flux_billing_cents: number;
  flux_margin_cents: number;
  margin_pct_applied: number;
  commission_pct_applied: number;
  amount_cents: number;
  status: string;
  payable_id: string | null;
};

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, '0')}` };
}

function dueDateForMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const payMonth = m === 12 ? 1 : m + 1;
  const payYear = m === 12 ? y + 1 : y;
  return `${payYear}-${String(payMonth).padStart(2, '0')}-15`;
}

async function loadFluxMarginPct(workspaceId: string): Promise<number> {
  const { data, error } = await supabase
    .from('billing_legal_entities')
    .select('flux_service_margin_pct')
    .eq('workspace_id', workspaceId)
    .eq('entity_type', 'flux')
    .maybeSingle();
  if (error) throw new Error(error.message);
  const pct = Number(data?.flux_service_margin_pct);
  return Number.isFinite(pct) && pct > 0 ? pct : 30;
}

export async function accrueLeaderFluxCommissionsForMonth(
  workspaceId: string,
  month: string
): Promise<{ created: number; skipped: number }> {
  const { start, end } = monthBounds(month);
  const marginPct = await loadFluxMarginPct(workspaceId);
  const now = new Date().toISOString();

  const { data: cycles, error: cycleErr } = await supabase
    .from('billing_cycles')
    .select('id')
    .eq('workspace_id', workspaceId)
    .gte('apuracao_end', start)
    .lte('apuracao_end', end);
  if (cycleErr) throw new Error(cycleErr.message);

  const cycleIds = (cycles || []).map((c) => String(c.id));
  if (!cycleIds.length) return { created: 0, skipped: 0 };

  const { data: settlements, error: stErr } = await supabase
    .from('billing_settlements')
    .select('pharmacy_id, flux_cents, status')
    .eq('workspace_id', workspaceId)
    .in('billing_cycle_id', cycleIds)
    .in('status', ['approved', 'paid']);
  if (stErr) throw new Error(stErr.message);

  const fluxByPharmacy = new Map<string, number>();
  for (const row of settlements || []) {
    const pid = String(row.pharmacy_id);
    const cents = Number(row.flux_cents) || 0;
    if (cents <= 0) continue;
    fluxByPharmacy.set(pid, (fluxByPharmacy.get(pid) || 0) + cents);
  }

  if (!fluxByPharmacy.size) return { created: 0, skipped: 0 };

  const pharmacyIds = [...fluxByPharmacy.keys()];
  const { data: pharmacies, error: phErr } = await supabase
    .from('pharmacies')
    .select('id, trade_name, leader_id, contract_scope')
    .eq('workspace_id', workspaceId)
    .in('id', pharmacyIds);
  if (phErr) throw new Error(phErr.message);

  const pharmacyById = new Map((pharmacies || []).map((p) => [String(p.id), p]));
  const leaderIds = [...new Set((pharmacies || []).map((p) => p.leader_id).filter(Boolean).map(String))];

  const rulesByLeader = new Map<string, number>();
  if (leaderIds.length) {
    const { data: rules, error: ruleErr } = await supabase
      .from('billing_leader_commission_rules')
      .select('leader_id, percent_of_flux_margin, active')
      .eq('workspace_id', workspaceId)
      .in('leader_id', leaderIds)
      .eq('active', true);
    if (ruleErr) throw new Error(ruleErr.message);
    for (const r of rules || []) {
      rulesByLeader.set(String(r.leader_id), Number(r.percent_of_flux_margin) || 0);
    }
  }

  let created = 0;
  let skipped = 0;

  for (const [pharmacyId, fluxBillingCents] of fluxByPharmacy) {
    const pharmacy = pharmacyById.get(pharmacyId);
    if (!pharmacy?.leader_id) {
      skipped += 1;
      continue;
    }
    const scope = String(pharmacy.contract_scope || 'both');
    if (scope === 'coop_only') {
      skipped += 1;
      continue;
    }

    const leaderId = String(pharmacy.leader_id);
    const commissionPct = rulesByLeader.get(leaderId) || 0;
    if (commissionPct <= 0) {
      skipped += 1;
      continue;
    }

    const { data: existing } = await supabase
      .from('billing_leader_commission_accruals')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('leader_id', leaderId)
      .eq('pharmacy_id', pharmacyId)
      .eq('competence_month', month)
      .maybeSingle();
    if (existing) {
      skipped += 1;
      continue;
    }

    const fluxMarginCents = Math.round((fluxBillingCents * marginPct) / 100);
    const amountCents = Math.round((fluxMarginCents * commissionPct) / 100);
    if (amountCents <= 0) {
      skipped += 1;
      continue;
    }

    const { error: insErr } = await supabase.from('billing_leader_commission_accruals').insert({
      workspace_id: workspaceId,
      leader_id: leaderId,
      pharmacy_id: pharmacyId,
      competence_month: month,
      flux_billing_cents: fluxBillingCents,
      flux_margin_cents: fluxMarginCents,
      margin_pct_applied: marginPct,
      commission_pct_applied: commissionPct,
      amount_cents: amountCents,
      status: 'draft',
      updated_at: now,
    });
    if (insErr) throw new Error(insErr.message);
    created += 1;
  }

  return { created, skipped };
}

export async function generateLeaderCommissionPayables(
  workspaceId: string,
  month: string
): Promise<{ payables: number; accruals_linked: number }> {
  const dueDate = dueDateForMonth(month);
  const now = new Date().toISOString();

  const { data: accruals, error } = await supabase
    .from('billing_leader_commission_accruals')
    .select('id, leader_id, amount_cents, payable_id, status')
    .eq('workspace_id', workspaceId)
    .eq('competence_month', month)
    .is('payable_id', null)
    .in('status', ['draft', 'approved']);
  if (error) throw new Error(error.message);

  const byLeader = new Map<string, { cents: number; ids: string[] }>();
  for (const a of accruals || []) {
    if (a.status === 'cancelled') continue;
    const lid = String(a.leader_id);
    const cur = byLeader.get(lid) || { cents: 0, ids: [] };
    cur.cents += Number(a.amount_cents) || 0;
    cur.ids.push(String(a.id));
    byLeader.set(lid, cur);
  }

  let payables = 0;
  let accrualsLinked = 0;

  for (const [leaderId, agg] of byLeader) {
    if (agg.cents <= 0) continue;

    const { data: leader, error: lErr } = await supabase
      .from('leaders')
      .select('id, name, status')
      .eq('workspace_id', workspaceId)
      .eq('id', leaderId)
      .maybeSingle();
    if (lErr) throw new Error(lErr.message);
    if (!leader || leader.status !== 'active') continue;

    const { data: existing } = await supabase
      .from('billing_payables')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('beneficiary_type', 'leader')
      .eq('beneficiary_id', leaderId)
      .eq('competence_month', month)
      .eq('category', 'leader_flux_commission')
      .maybeSingle();
    if (existing) continue;

    const { data: payable, error: payErr } = await supabase
      .from('billing_payables')
      .insert({
        workspace_id: workspaceId,
        beneficiary_type: 'leader',
        beneficiary_id: leaderId,
        legal_entity_type: 'flux',
        description: `Comissão operação Flux ${month} — ${leader.name}`,
        amount_cents: agg.cents,
        due_date: dueDate,
        competence_month: month,
        category: 'leader_flux_commission',
        status: 'draft',
        updated_at: now,
      })
      .select('id')
      .single();
    if (payErr) throw new Error(payErr.message);

    const { error: linkErr } = await supabase
      .from('billing_leader_commission_accruals')
      .update({ payable_id: payable.id, status: 'approved', updated_at: now })
      .eq('workspace_id', workspaceId)
      .in('id', agg.ids);
    if (linkErr) throw new Error(linkErr.message);

    payables += 1;
    accrualsLinked += agg.ids.length;
  }

  return { payables, accruals_linked: accrualsLinked };
}

export async function buildLeaderCommissionReport(
  workspaceId: string,
  month: string
): Promise<{ rows: LeaderCommissionReportRow[]; total_cents: number }> {
  const { data: accruals, error } = await supabase
    .from('billing_leader_commission_accruals')
    .select(
      'id, leader_id, pharmacy_id, competence_month, flux_billing_cents, flux_margin_cents, margin_pct_applied, commission_pct_applied, amount_cents, status, payable_id, leader:leaders!leader_id(name), pharmacy:pharmacies!pharmacy_id(trade_name)'
    )
    .eq('workspace_id', workspaceId)
    .eq('competence_month', month)
    .neq('status', 'cancelled')
    .order('leader_id');
  if (error) throw new Error(error.message);

  const rows: LeaderCommissionReportRow[] = (accruals || []).map((a) => {
    const leader = a.leader as { name?: string } | null;
    const pharmacy = a.pharmacy as { trade_name?: string } | null;
    return {
      accrual_id: String(a.id),
      leader_id: String(a.leader_id),
      leader_name: String(leader?.name || '—'),
      pharmacy_id: String(a.pharmacy_id),
      pharmacy_name: String(pharmacy?.trade_name || '—'),
      competence_month: String(a.competence_month),
      flux_billing_cents: Number(a.flux_billing_cents) || 0,
      flux_margin_cents: Number(a.flux_margin_cents) || 0,
      margin_pct_applied: Number(a.margin_pct_applied) || 0,
      commission_pct_applied: Number(a.commission_pct_applied) || 0,
      amount_cents: Number(a.amount_cents) || 0,
      status: String(a.status),
      payable_id: a.payable_id ? String(a.payable_id) : null,
    };
  });

  rows.sort(
    (a, b) =>
      a.leader_name.localeCompare(b.leader_name, 'pt-BR') ||
      a.pharmacy_name.localeCompare(b.pharmacy_name, 'pt-BR')
  );
  const total_cents = rows.reduce((s, r) => s + r.amount_cents, 0);
  return { rows, total_cents };
}
