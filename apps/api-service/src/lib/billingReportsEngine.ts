import { supabase } from './supabase';

export type InssAccountingRow = {
  driver_id: string;
  name: string;
  cpf: string | null;
  gross_remuneration_cents: number;
};

export type InsuranceDriverRow = {
  driver_id: string;
  name: string;
  cpf: string | null;
  birth_date: string | null;
  gender?: string | null;
  registration?: string | number | null;
  phone: string | null;
  contract_started_at: string | null;
  leader_name: string | null;
  pharmacies: string;
  inactive_at?: string | null;
  termination_reason?: string | null;
};

const VERIFIED_SETTLEMENT_STATUSES = ['approved', 'paid'];

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, '0')}` };
}

function moneyToCents(amount: number): number {
  return Math.round(amount * 100);
}

export async function buildInssAccountingReport(
  workspaceId: string,
  month: string
): Promise<{ rows: InssAccountingRow[]; total_cents: number }> {
  const { start, end } = monthBounds(month);

  const { data: cycles, error: cycleErr } = await supabase
    .from('billing_cycles')
    .select('id')
    .eq('workspace_id', workspaceId)
    .gte('apuracao_end', start)
    .lte('apuracao_end', end);
  if (cycleErr) throw new Error(cycleErr.message);

  const cycleIds = (cycles || []).map((c) => String(c.id));
  const byDriver = new Map<string, number>();

  if (cycleIds.length) {
    const { data: settlements, error: stErr } = await supabase
      .from('billing_settlements')
      .select('driver_id, operational_net_driver_payout_cents, net_driver_payout_cents, status')
      .in('billing_cycle_id', cycleIds)
      .in('status', VERIFIED_SETTLEMENT_STATUSES);
    if (stErr) throw new Error(stErr.message);

    for (const row of settlements || []) {
      const id = String(row.driver_id);
      const operational =
        Number(row.operational_net_driver_payout_cents) ||
        Number(row.net_driver_payout_cents || 0);
      byDriver.set(id, (byDriver.get(id) || 0) + operational);
    }
  }

  const dailyStatuses = ['approved', 'settled', 'active'];
  const { data: dailyRows, error: dailyErr } = await supabase
    .from('financial_entries')
    .select('driver_id, total_amount, status, apuracao_start, apuracao_end')
    .eq('workspace_id', workspaceId)
    .eq('type', 'daily')
    .gte('apuracao_end', start)
    .lte('apuracao_start', end);
  if (dailyErr) throw new Error(dailyErr.message);

  for (const row of dailyRows || []) {
    if (!dailyStatuses.includes(String(row.status))) continue;
    const id = String(row.driver_id);
    byDriver.set(id, (byDriver.get(id) || 0) + moneyToCents(Number(row.total_amount)));
  }

  const driverIds = [...byDriver.keys()].filter((id) => (byDriver.get(id) || 0) > 0);
  if (!driverIds.length) return { rows: [], total_cents: 0 };

  const { data: drivers, error: drvErr } = await supabase
    .from('drivers')
    .select('id, name, cpf')
    .eq('workspace_id', workspaceId)
    .in('id', driverIds);
  if (drvErr) throw new Error(drvErr.message);

  const driverById = new Map((drivers || []).map((d) => [String(d.id), d]));
  const rows: InssAccountingRow[] = driverIds
    .map((id) => {
      const d = driverById.get(id);
      const gross = byDriver.get(id) || 0;
      return {
        driver_id: id,
        name: d ? String(d.name) : id,
        cpf: d?.cpf ? String(d.cpf) : null,
        gross_remuneration_cents: gross,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const total_cents = rows.reduce((s, r) => s + r.gross_remuneration_cents, 0);
  return { rows, total_cents };
}

async function enrichInsuranceRows(
  workspaceId: string,
  driverIds: string[]
): Promise<InsuranceDriverRow[]> {
  if (!driverIds.length) return [];

  const { data: drivers, error: drvErr } = await supabase
    .from('drivers')
    .select(
      'id, name, cpf, phone, birth_date, created_at, inactive_at, termination_reason, override_leader_id, leaders:override_leader_id(name)'
    )
    .eq('workspace_id', workspaceId)
    .in('id', driverIds);
  if (drvErr) throw new Error(drvErr.message);

  const { data: links, error: linkErr } = await supabase
    .from('driver_pharmacy_links')
    .select('driver_id, is_active, started_at, pharmacies(id, trade_name, name)')
    .eq('workspace_id', workspaceId)
    .in('driver_id', driverIds)
    .eq('is_active', true);
  if (linkErr) throw new Error(linkErr.message);

  const pharmaciesByDriver = new Map<string, string[]>();
  const linkStartByDriver = new Map<string, string>();
  for (const link of links || []) {
    const id = String(link.driver_id);
    const ph = link.pharmacies as { trade_name?: string; name?: string } | { trade_name?: string; name?: string }[] | null;
    const row = Array.isArray(ph) ? ph[0] : ph;
    const label = row?.trade_name || row?.name || 'Farmácia';
    if (!pharmaciesByDriver.has(id)) pharmaciesByDriver.set(id, []);
    pharmaciesByDriver.get(id)!.push(label);
    if (link.started_at) {
      const cur = linkStartByDriver.get(id);
      const started = String(link.started_at).slice(0, 10);
      if (!cur || started < cur) linkStartByDriver.set(id, started);
    }
  }

  return (drivers || []).map((d) => {
    const rawLeader = d.leaders as { name?: string } | { name?: string }[] | null;
    const leader = Array.isArray(rawLeader) ? rawLeader[0] : rawLeader;
    const driverId = String(d.id);
    return {
      driver_id: driverId,
      name: String(d.name),
      cpf: d.cpf ? String(d.cpf) : null,
      birth_date: d.birth_date ? String(d.birth_date).slice(0, 10) : null,
      phone: d.phone ? String(d.phone) : null,
      contract_started_at: linkStartByDriver.get(driverId) || String(d.created_at).slice(0, 10),
      leader_name: leader?.name ? String(leader.name) : null,
      pharmacies: (pharmaciesByDriver.get(driverId) || []).join('; '),
      inactive_at: d.inactive_at ? String(d.inactive_at).slice(0, 10) : null,
      termination_reason: d.termination_reason ? String(d.termination_reason) : null,
    };
  });
}

export async function buildInsuranceActiveReport(
  workspaceId: string,
  cutoffDate: string
): Promise<{ rows: InsuranceDriverRow[]; cutoff_date: string }> {
  const { data: activeDrivers, error: drvErr } = await supabase
    .from('drivers')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active');
  if (drvErr) throw new Error(drvErr.message);

  const candidateIds = (activeDrivers || []).map((d) => String(d.id));
  if (!candidateIds.length) return { rows: [], cutoff_date: cutoffDate };

  const { data: links, error: linkErr } = await supabase
    .from('driver_pharmacy_links')
    .select('driver_id')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .in('driver_id', candidateIds);
  if (linkErr) throw new Error(linkErr.message);

  const withLink = [...new Set((links || []).map((l) => String(l.driver_id)))];
  const rows = await enrichInsuranceRows(workspaceId, withLink);
  rows.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return { rows, cutoff_date: cutoffDate };
}

export async function buildInsuranceTerminatedReport(
  workspaceId: string,
  month: string
): Promise<{ rows: InsuranceDriverRow[] }> {
  const { start, end } = monthBounds(month);

  const { data: drivers, error: drvErr } = await supabase
    .from('drivers')
    .select('id')
    .eq('workspace_id', workspaceId)
    .gte('inactive_at', start)
    .lte('inactive_at', end);
  if (drvErr) throw new Error(drvErr.message);

  const ids = (drivers || []).map((d) => String(d.id));
  const rows = await enrichInsuranceRows(workspaceId, ids);
  rows.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return { rows };
}

export function reportRowsToCsv(headers: string[], rows: Record<string, string | number | null>[]): string {
  const escape = (v: string | number | null) => {
    const s = v == null ? '' : String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h] ?? null)).join(','));
  }
  return lines.join('\n');
}

export async function recordReportRun(
  workspaceId: string,
  kind: 'inss_accounting' | 'insurance_active' | 'insurance_terminated',
  month: string,
  rowCount: number,
  totalCents: number | null,
  cutoffDate: string | null,
  actorId: string | null,
  markSent: boolean
) {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    workspace_id: workspaceId,
    report_kind: kind,
    competence_month: month,
    cutoff_date: cutoffDate,
    row_count: rowCount,
    total_cents: totalCents,
    metadata: {},
  };
  if (markSent) {
    patch.sent_at = now;
    patch.sent_by = actorId;
  }

  const { data, error } = await supabase
    .from('billing_monthly_report_runs')
    .upsert(patch, { onConflict: 'workspace_id,report_kind,competence_month' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}
