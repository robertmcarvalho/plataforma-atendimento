import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getAttendantPortfolioPharmacyIds,
  getLeadersForAttendantPortfolio,
  intersectPortfolioWithLeader,
} from './attendantPortfolio';
import { getLeaderManagedPharmacyIds } from './leaderPortalScope';
import { loadOperationalDriverScope } from './operationalDriverScope';

export type OpsHubQueryOpts = {
  referenceDate?: string;
  pharmacyId?: string;
  taskType?: string;
  status?: string;
  assigneeId?: string;
  dateFrom?: string;
  dateTo?: string;
};

function scopePharmacyIds(pharmacyIds: string[], pharmacyId?: string): string[] {
  if (!pharmacyId) return pharmacyIds;
  return pharmacyIds.includes(pharmacyId) ? [pharmacyId] : [];
}

function startOfDaysAgoIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function periodSinceIso(periodDays: number) {
  return startOfDaysAgoIso(Math.max(1, Math.min(90, periodDays)));
}

const PENDING_ABSENCE_STATUSES = ['informed', 'pending_approval', 'active'];

export type PortfolioAlert = {
  severity: 'high' | 'medium' | 'low';
  type: string;
  message: string;
  href?: string;
};

export type PortfolioPharmacyRow = {
  id: string;
  trade_name: string;
  leader_id: string | null;
  leader_name: string | null;
  drivers_count: number;
  open_conversations: number;
  sla_percent: number;
  pending_financial: number;
  pending_absences: number;
  pending_dailies: number;
};

export type PortfolioLeaderRow = {
  id: string;
  name: string;
  pharmacies_count: number;
  pending_absences: number;
  pending_dailies: number;
};

export type PortfolioSummary = {
  period_days: number;
  totals: {
    pharmacies: number;
    drivers: number;
    leaders: number;
    open_conversations: number;
    pending_financial: number;
    open_tasks: number;
    doc_alerts: number;
    absences_without_coverage: number;
  };
  pharmacies: PortfolioPharmacyRow[];
  leaders: PortfolioLeaderRow[];
  alerts: PortfolioAlert[];
};

async function countFinancialByPharmacy(
  db: SupabaseClient,
  workspaceId: string,
  pharmacyIds: string[]
): Promise<{
  pendingFinancial: Map<string, number>;
  pendingAbsences: Map<string, number>;
  pendingDailies: Map<string, number>;
}> {
  const pendingFinancial = new Map<string, number>();
  const pendingAbsences = new Map<string, number>();
  const pendingDailies = new Map<string, number>();
  if (!pharmacyIds.length) return { pendingFinancial, pendingAbsences, pendingDailies };

  const { data: entries } = await db
    .from('financial_entries')
    .select('pharmacy_id, type, status')
    .eq('workspace_id', workspaceId)
    .in('pharmacy_id', pharmacyIds)
    .in('status', ['informed', 'pending_approval', 'active']);

  for (const e of entries || []) {
    const pid = e.pharmacy_id ? String(e.pharmacy_id) : '';
    if (!pid) continue;
    const type = String(e.type || '');
    const status = String(e.status || '');
    pendingFinancial.set(pid, (pendingFinancial.get(pid) || 0) + 1);
    if (type === 'absence' && PENDING_ABSENCE_STATUSES.includes(status)) {
      pendingAbsences.set(pid, (pendingAbsences.get(pid) || 0) + 1);
    }
    if (type === 'daily' && status === 'pending_approval') {
      pendingDailies.set(pid, (pendingDailies.get(pid) || 0) + 1);
    }
  }
  return { pendingFinancial, pendingAbsences, pendingDailies };
}

async function enrichPharmacyRows(
  db: SupabaseClient,
  workspaceId: string,
  pharmacyIds: string[],
  slaDays: number
): Promise<PortfolioPharmacyRow[]> {
  if (!pharmacyIds.length) return [];

  const sinceSla = startOfDaysAgoIso(slaDays);

  const { data: pharmacies, error } = await db
    .from('pharmacies')
    .select(
      `id, trade_name, leader_id, leader:leaders(id, name), leader_pharmacy_links(leader_id, is_active, leaders(id, name))`
    )
    .eq('workspace_id', workspaceId)
    .in('id', pharmacyIds)
    .order('trade_name');
  if (error) throw new Error(error.message);

  const [driverLinks, openConvs, slaConvs, finMaps] = await Promise.all([
    db
      .from('driver_pharmacy_links')
      .select('pharmacy_id')
      .eq('workspace_id', workspaceId)
      .in('pharmacy_id', pharmacyIds)
      .eq('is_active', true)
      .limit(20000),
    db
      .from('conversations')
      .select('context_pharmacy_id')
      .eq('workspace_id', workspaceId)
      .in('context_pharmacy_id', pharmacyIds)
      .in('status', ['open', 'pending'])
      .limit(20000),
    db
      .from('conversations')
      .select('context_pharmacy_id, sla_resolved_ok')
      .eq('workspace_id', workspaceId)
      .in('context_pharmacy_id', pharmacyIds)
      .gte('created_at', sinceSla)
      .not('sla_resolved_ok', 'is', null)
      .limit(20000),
    countFinancialByPharmacy(db, workspaceId, pharmacyIds),
  ]);

  const driversCount = new Map<string, number>();
  for (const r of driverLinks.data || []) {
    const id = r.pharmacy_id ? String(r.pharmacy_id) : '';
    if (id) driversCount.set(id, (driversCount.get(id) || 0) + 1);
  }
  const openCount = new Map<string, number>();
  for (const r of openConvs.data || []) {
    const id = r.context_pharmacy_id ? String(r.context_pharmacy_id) : '';
    if (id) openCount.set(id, (openCount.get(id) || 0) + 1);
  }
  const slaOk = new Map<string, number>();
  const slaTotal = new Map<string, number>();
  for (const r of slaConvs.data || []) {
    const id = r.context_pharmacy_id ? String(r.context_pharmacy_id) : '';
    if (!id) continue;
    slaTotal.set(id, (slaTotal.get(id) || 0) + 1);
    if (r.sla_resolved_ok === true) slaOk.set(id, (slaOk.get(id) || 0) + 1);
  }

  return (pharmacies || []).map((p: Record<string, unknown>) => {
    const id = String(p.id);
    const linkedLeader = (
      (p.leader_pharmacy_links as Array<{ is_active?: boolean; leaders?: { id?: string; name?: string } }>) || []
    ).find((x) => x?.is_active)?.leaders;
    const leader = (p.leader as { id?: string; name?: string } | null) || linkedLeader || null;
    const total = slaTotal.get(id) || 0;
    const ok = slaOk.get(id) || 0;
    const slaPercent = total > 0 ? Math.round((ok / total) * 1000) / 10 : 0;
    return {
      id,
      trade_name: String(p.trade_name || ''),
      leader_id: leader?.id ? String(leader.id) : p.leader_id ? String(p.leader_id) : null,
      leader_name: leader?.name ? String(leader.name) : null,
      drivers_count: driversCount.get(id) || 0,
      open_conversations: openCount.get(id) || 0,
      sla_percent: slaPercent,
      pending_financial: finMaps.pendingFinancial.get(id) || 0,
      pending_absences: finMaps.pendingAbsences.get(id) || 0,
      pending_dailies: finMaps.pendingDailies.get(id) || 0,
    };
  });
}

export async function getAllWorkspacePharmacyIds(
  db: SupabaseClient,
  workspaceId: string
): Promise<string[]> {
  const { data, error } = await db
    .from('pharmacies')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active');
  if (error) throw new Error(error.message);
  return (data || []).map((r) => String(r.id)).filter(Boolean);
}

/** Restringe IDs às farmácias com status active no workspace. */
export async function filterActivePharmacyIds(
  db: SupabaseClient,
  workspaceId: string,
  pharmacyIds: string[]
): Promise<string[]> {
  if (!pharmacyIds.length) return [];
  const { data, error } = await db
    .from('pharmacies')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .in('id', pharmacyIds);
  if (error) throw new Error(error.message);
  const active = new Set((data || []).map((r) => String(r.id)));
  return pharmacyIds.filter((id) => active.has(id));
}

export async function buildPortfolioSummaryForScope(
  db: SupabaseClient,
  workspaceId: string,
  pharmacyIds: string[],
  periodDays = 30,
  attendantUserId?: string | null
): Promise<PortfolioSummary> {
  const leaderIds = await getLeadersForAttendantPortfolio(db, workspaceId, pharmacyIds);
  const since = periodSinceIso(periodDays);

  const pharmacies = await enrichPharmacyRows(db, workspaceId, pharmacyIds, periodDays);

  let driversCount = 0;
  if (pharmacyIds.length) {
    const { data: links } = await db
      .from('driver_pharmacy_links')
      .select('driver_id')
      .eq('workspace_id', workspaceId)
      .in('pharmacy_id', pharmacyIds)
      .eq('is_active', true);
    driversCount = new Set((links || []).map((l) => l.driver_id).filter(Boolean)).size;
  }

  let openConversations = 0;
  if (pharmacyIds.length) {
    const { count } = await db
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .in('context_pharmacy_id', pharmacyIds)
      .in('status', ['open', 'pending']);
    openConversations = count || 0;
  }

  const finMaps = await countFinancialByPharmacy(db, workspaceId, pharmacyIds);
  let pendingFinancial = 0;
  for (const n of finMaps.pendingFinancial.values()) pendingFinancial += n;

  let openTasksQuery = db
    .from('pending_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .in('status', ['open', 'in_progress']);
  if (attendantUserId) {
    openTasksQuery = openTasksQuery.eq('assignee_id', attendantUserId);
  }
  const { count: openTasks } = await openTasksQuery;

  let docAlerts = 0;
  if (pharmacyIds.length) {
    const in30 = new Date();
    in30.setDate(in30.getDate() + 30);
    const horizon = in30.toISOString().slice(0, 10);
    const { data: docLinks } = await db
      .from('driver_pharmacy_links')
      .select('driver_id')
      .in('pharmacy_id', pharmacyIds)
      .eq('is_active', true);
    const docDriverIds = Array.from(new Set((docLinks || []).map((l) => l.driver_id).filter(Boolean)));
    if (docDriverIds.length) {
      const { count: docCount } = await db
        .from('drivers')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .in('id', docDriverIds)
        .or(`cnh_expires_at.lte.${horizon},digital_certificate_expires_at.lte.${horizon}`);
      docAlerts = docCount || 0;
    }
  }

  let absencesWithoutCoverage = 0;
  if (pharmacyIds.length) {
    const { count } = await db
      .from('financial_entries')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .in('pharmacy_id', pharmacyIds)
      .eq('type', 'absence')
      .eq('occurrence_kind', 'unexcused')
      .is('coverage_of_entry_id', null)
      .gte('event_date', since.slice(0, 10))
      .in('status', PENDING_ABSENCE_STATUSES);
    absencesWithoutCoverage = count || 0;
  }

  const leaders: PortfolioLeaderRow[] = [];
  if (leaderIds.length) {
    const { data: leaderRows } = await db
      .from('leaders')
      .select('id, name')
      .eq('workspace_id', workspaceId)
      .in('id', leaderIds)
      .order('name');

    for (const l of leaderRows || []) {
      const intersectIds = attendantUserId
        ? await intersectPortfolioWithLeader(db, attendantUserId, String(l.id), workspaceId)
        : (await getLeaderManagedPharmacyIds(db, String(l.id), workspaceId)).filter((id) =>
            pharmacyIds.includes(id)
          );
      const maps = await countFinancialByPharmacy(db, workspaceId, intersectIds);
      let pa = 0;
      let pd = 0;
      for (const v of maps.pendingAbsences.values()) pa += v;
      for (const v of maps.pendingDailies.values()) pd += v;
      leaders.push({
        id: String(l.id),
        name: String(l.name || ''),
        pharmacies_count: intersectIds.length,
        pending_absences: pa,
        pending_dailies: pd,
      });
    }
  }

  const alerts: PortfolioAlert[] = [];
  for (const p of pharmacies) {
    if (p.sla_percent > 0 && p.sla_percent < 70) {
      alerts.push({
        severity: 'high',
        type: 'sla',
        message: `${p.trade_name}: SLA ${p.sla_percent}%`,
        href: `/pharmacies/${p.id}`,
      });
    }
    if (p.pending_absences > 0 && p.open_conversations > 2) {
      alerts.push({
        severity: 'medium',
        type: 'backlog',
        message: `${p.trade_name}: ${p.pending_absences} falta(s) pendente(s)`,
        href: `/pharmacies/${p.id}`,
      });
    }
  }
  if (absencesWithoutCoverage > 0) {
    alerts.push({
      severity: 'high',
      type: 'coverage',
      message: `${absencesWithoutCoverage} falta(s) sem cobertura no período`,
    });
  }
  alerts.sort((a, b) => (a.severity === 'high' ? -1 : 1) - (b.severity === 'high' ? -1 : 1));
  const alertsTop = alerts.slice(0, 12);

  pharmacies.sort(
    (a, b) =>
      b.pending_financial + b.open_conversations - (a.pending_financial + a.open_conversations) ||
      a.sla_percent - b.sla_percent
  );

  return {
    period_days: periodDays,
    totals: {
      pharmacies: pharmacyIds.length,
      drivers: driversCount,
      leaders: leaderIds.length,
      open_conversations: openConversations,
      pending_financial: pendingFinancial,
      open_tasks: openTasks || 0,
      doc_alerts: docAlerts,
      absences_without_coverage: absencesWithoutCoverage,
    },
    pharmacies,
    leaders,
    alerts: alertsTop,
  };
}

export async function buildPortfolioSummary(
  db: SupabaseClient,
  workspaceId: string,
  attendantUserId: string,
  periodDays = 30
): Promise<PortfolioSummary> {
  const rawIds = await getAttendantPortfolioPharmacyIds(db, workspaceId, attendantUserId);
  const pharmacyIds = await filterActivePharmacyIds(db, workspaceId, rawIds);
  return buildPortfolioSummaryForScope(db, workspaceId, pharmacyIds, periodDays, attendantUserId);
}

export type LaunchContext = {
  leaders: Array<{ id: string; name: string; pharmacy_ids: string[] }>;
  pharmacies: Array<{ id: string; trade_name: string }>;
  drivers: Array<{
    id: string;
    name: string;
    primary_pharmacy_id: string | null;
    leader_linked_pharmacy_ids: string[];
  }>;
};

export async function buildPortfolioLaunchContext(
  db: SupabaseClient,
  workspaceId: string,
  attendantUserId: string,
  preselectedLeaderId?: string
): Promise<LaunchContext> {
  const rawIds = await getAttendantPortfolioPharmacyIds(db, workspaceId, attendantUserId);
  const pharmacyIds = await filterActivePharmacyIds(db, workspaceId, rawIds);
  const leaderIds = await getLeadersForAttendantPortfolio(db, workspaceId, pharmacyIds);

  const { data: pharmacyRows } = await db
    .from('pharmacies')
    .select('id, trade_name, leader_id, leader:leaders(id, name)')
    .eq('workspace_id', workspaceId)
    .in('id', pharmacyIds.length ? pharmacyIds : ['00000000-0000-0000-0000-000000000000'])
    .order('trade_name');

  const leaders: LaunchContext['leaders'] = [];
  for (const lid of leaderIds) {
    const intersect = await intersectPortfolioWithLeader(db, attendantUserId, lid, workspaceId);
    const { data: l } = await db.from('leaders').select('id, name').eq('id', lid).maybeSingle();
    if (l) {
      leaders.push({
        id: String(l.id),
        name: String(l.name || ''),
        pharmacy_ids: intersect,
      });
    }
  }

  const activePharmacyIds = preselectedLeaderId
    ? leaders.find((x) => x.id === preselectedLeaderId)?.pharmacy_ids ?? []
    : pharmacyIds;

  let driverRows: LaunchContext['drivers'] = [];
  if (activePharmacyIds.length) {
    const scope = await loadOperationalDriverScope(db, workspaceId, activePharmacyIds);
    const driverIds = Array.from(scope.driverIds);
    if (driverIds.length) {
      const { data: drivers } = await db
        .from('drivers')
        .select('id, name, primary_pharmacy_id, status')
        .eq('workspace_id', workspaceId)
        .in('id', driverIds)
        .eq('status', 'active')
        .order('name');
      driverRows = (drivers || []).map((d) => ({
        id: String(d.id),
        name: String(d.name || ''),
        primary_pharmacy_id: d.primary_pharmacy_id ? String(d.primary_pharmacy_id) : null,
        leader_linked_pharmacy_ids: scope.pharmacyIdsByDriver.get(String(d.id)) || [],
      }));
    }
  }

  return {
    leaders,
    pharmacies: (pharmacyRows || []).map((p) => {
      const leader = Array.isArray(p.leader) ? p.leader[0] : p.leader;
      return {
        id: String(p.id),
        trade_name: String(p.trade_name || ''),
        leader_id: p.leader_id ? String(p.leader_id) : null,
        leader_name: leader?.name ? String(leader.name) : null,
      };
    }),
    drivers: driverRows,
  };
}

export type CoordinationLeaderRow = {
  id: string;
  name: string;
  status: string;
  pharmacies_count: number;
  pending_absences: number;
  pending_dailies: number;
  sla_percent: number;
};

export type CoordinationSummary = {
  period_days: number;
  totals: {
    pharmacies_active: number;
    leaders_active: number;
    drivers_active: number;
    open_conversations: number;
    pending_financial: number;
    absences_without_coverage_pct: number;
  };
  financial_funnel: Record<string, number>;
  leaders: CoordinationLeaderRow[];
  pharmacies: PortfolioPharmacyRow[];
  attendant_occurrences: Array<{
    attendant_id: string;
    attendant_name: string;
    count: number;
    by_leader: Array<{ leader_id: string; leader_name: string; count: number }>;
  }>;
};

export async function buildCoordinationSummary(
  db: SupabaseClient,
  workspaceId: string,
  periodDays = 30
): Promise<CoordinationSummary> {
  const since = periodSinceIso(periodDays);
  const sinceDate = since.slice(0, 10);

  const { data: allPharmacies } = await db
    .from('pharmacies')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active');
  const pharmacyIds = (allPharmacies || []).map((p) => String(p.id));

  const { count: leadersActive } = await db
    .from('leaders')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('status', 'active');

  const { count: driversActive } = await db
    .from('drivers')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('status', 'active');

  const { count: openConversations } = await db
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .in('status', ['open', 'pending']);

  const finMaps = await countFinancialByPharmacy(db, workspaceId, pharmacyIds);
  let pendingFinancial = 0;
  for (const v of finMaps.pendingFinancial.values()) pendingFinancial += v;

  const { data: funnelRows } = await db
    .from('financial_entries')
    .select('status, type')
    .eq('workspace_id', workspaceId)
    .gte('created_at', since)
    .in('type', ['absence', 'daily']);
  const financial_funnel: Record<string, number> = {};
  for (const r of funnelRows || []) {
    const key = `${r.type}:${r.status}`;
    financial_funnel[key] = (financial_funnel[key] || 0) + 1;
  }

  const { count: unexcusedTotal } = await db
    .from('financial_entries')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('type', 'absence')
    .eq('occurrence_kind', 'unexcused')
    .gte('event_date', sinceDate);
  const { count: unexcusedNoCov } = await db
    .from('financial_entries')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('type', 'absence')
    .eq('occurrence_kind', 'unexcused')
    .is('coverage_of_entry_id', null)
    .gte('event_date', sinceDate);
  const absences_without_coverage_pct =
    (unexcusedTotal || 0) > 0
      ? Math.round(((unexcusedNoCov || 0) / (unexcusedTotal || 1)) * 1000) / 10
      : 0;

  const { data: leaderRows } = await db
    .from('leaders')
    .select('id, name, status')
    .eq('workspace_id', workspaceId)
    .order('name');

  const leaders: CoordinationLeaderRow[] = [];
  for (const l of leaderRows || []) {
    const managed = await getLeaderManagedPharmacyIds(db, String(l.id), workspaceId);
    const maps = await countFinancialByPharmacy(db, workspaceId, managed);
    let pa = 0;
    let pd = 0;
    for (const v of maps.pendingAbsences.values()) pa += v;
    for (const v of maps.pendingDailies.values()) pd += v;

    const { data: slaConvs } = await db
      .from('conversations')
      .select('sla_resolved_ok')
      .eq('workspace_id', workspaceId)
      .eq('context_leader_id', l.id)
      .gte('created_at', since)
      .not('sla_resolved_ok', 'is', null)
      .limit(5000);
    const slaList = slaConvs || [];
    const slaPercent =
      slaList.length > 0
        ? Math.round((slaList.filter((c) => c.sla_resolved_ok === true).length / slaList.length) * 1000) / 10
        : 0;

    leaders.push({
      id: String(l.id),
      name: String(l.name || ''),
      status: String(l.status || 'active'),
      pharmacies_count: managed.length,
      pending_absences: pa,
      pending_dailies: pd,
      sla_percent: slaPercent,
    });
  }
  leaders.sort((a, b) => b.pending_absences + b.pending_dailies - (a.pending_absences + a.pending_dailies));

  const pharmacies = await enrichPharmacyRows(db, workspaceId, pharmacyIds.slice(0, 500), periodDays);
  pharmacies.sort((a, b) => b.pending_financial - a.pending_financial);

  const { data: auditRows } = await db
    .from('audit_logs')
    .select('actor_id, metadata, created_at')
    .eq('workspace_id', workspaceId)
    .eq('action', 'ops.occurrence.create_on_behalf')
    .gte('created_at', since)
    .limit(5000);

  const byAttendant = new Map<
    string,
    { count: number; byLeader: Map<string, number> }
  >();
  for (const row of auditRows || []) {
    const aid = row.actor_id ? String(row.actor_id) : '';
    if (!aid) continue;
    const meta = (row.metadata || {}) as Record<string, unknown>;
    const lid = String(meta.on_behalf_of_leader_id || '');
    const cur = byAttendant.get(aid) || { count: 0, byLeader: new Map() };
    cur.count += 1;
    if (lid) cur.byLeader.set(lid, (cur.byLeader.get(lid) || 0) + 1);
    byAttendant.set(aid, cur);
  }

  const attendantIds = Array.from(byAttendant.keys());
  const nameMap = new Map<string, string>();
  if (attendantIds.length) {
    const { data: users } = await db.from('users').select('id, name').in('id', attendantIds);
    for (const u of users || []) nameMap.set(String(u.id), String(u.name || ''));
  }
  const leaderNameMap = new Map((leaderRows || []).map((l) => [String(l.id), String(l.name || '')]));

  const attendant_occurrences = attendantIds.map((aid) => {
    const agg = byAttendant.get(aid)!;
    return {
      attendant_id: aid,
      attendant_name: nameMap.get(aid) || aid.slice(0, 8),
      count: agg.count,
      by_leader: Array.from(agg.byLeader.entries()).map(([leader_id, count]) => ({
        leader_id,
        leader_name: leaderNameMap.get(leader_id) || leader_id.slice(0, 8),
        count,
      })),
    };
  });

  return {
    period_days: periodDays,
    totals: {
      pharmacies_active: pharmacyIds.length,
      leaders_active: leadersActive || 0,
      drivers_active: driversActive || 0,
      open_conversations: openConversations || 0,
      pending_financial: pendingFinancial,
      absences_without_coverage_pct,
    },
    financial_funnel,
    leaders,
    pharmacies: pharmacies.slice(0, 50),
    attendant_occurrences,
  };
}

const FINANCIAL_TASK_TYPES = [
  'financial_advance_request',
  'driver_termination_financial_review',
] as const;

/** Tarefas de sistema (ex.: notificação de assinatura) não entram na fila operacional do hub. */
export const PORTFOLIO_HUB_EXCLUDED_TASK_TYPES = new Set(['driver_signature_notification']);

export type OpsHubTaskRow = {
  id: string;
  task_type: string;
  title: string;
  status: string;
  priority: string;
  due_at: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  driver_id: string | null;
  driver_name: string | null;
  conversation_id: string | null;
  pharmacy_name: string | null;
  /** Status externo (Autentique/outro) — somente leitura para fluxos. */
  signature_status: string | null;
};

export type OpsHubConversationRow = {
  id: string;
  status: string;
  priority: string;
  pharmacy_name: string | null;
  contact_name: string | null;
  attendant_name: string | null;
  updated_at: string;
};

export type OpsOperationsHub = {
  period_days: number;
  reference_date?: string | null;
  pharmacy_id?: string | null;
  summary: PortfolioSummary;
  tasks: OpsHubTaskRow[];
  conversations: OpsHubConversationRow[];
  notifications: PortfolioAlert[];
  kpis?: import('./operacaoHubExtend').OpsKpiRow[];
  pharmacy_cards?: import('./operacaoHubExtend').OpsPharmacyCard[];
  compliance?: import('./operacaoHubExtend').OpsComplianceRow[];
  signature_pending?: import('./operacaoHubExtend').OpsSignaturePending[];
  alerts_revive?: import('./operacaoHubExtend').OpsAlertRevive[];
  cycle_events?: import('./operacaoHubExtend').OpsCycleEventRow[];
};

export type FinancialOperationsHub = {
  period_days: number;
  reference_date?: string | null;
  pharmacy_id?: string | null;
  totals: {
    open_tasks: number;
    overdue_tasks: number;
    open_conversations: number;
    pending_financial: number;
    pending_advances: number;
  };
  tasks: OpsHubTaskRow[];
  conversations: OpsHubConversationRow[];
  notifications: PortfolioAlert[];
  financial_funnel: Record<string, number>;
  kpis?: import('./operacaoHubExtend').OpsKpiRow[];
  alerts_revive?: import('./operacaoHubExtend').OpsAlertRevive[];
  cycle_events?: import('./operacaoHubExtend').OpsCycleEventRow[];
  signature_pending?: import('./operacaoHubExtend').OpsSignaturePending[];
};

function signatureStatusFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const m = metadata as Record<string, unknown>;
  const termSig = m.termination_signature_status;
  if (termSig != null && String(termSig).trim()) return String(termSig).trim();
  const raw = m.signature_status ?? m.autentique_status ?? m.document_signature_status;
  return raw != null ? String(raw).trim() || null : null;
}

function mapTaskRows(
  rows: Array<Record<string, unknown>>,
  assigneeNames: Map<string, string>
): OpsHubTaskRow[] {
  return rows.map((t) => {
    const driver = t.driver as { name?: string } | { name?: string }[] | null;
    const driverRow = Array.isArray(driver) ? driver[0] : driver;
    const conv = t.conversation as { context_pharmacy?: { trade_name?: string } } | null;
    const pharmacy = conv?.context_pharmacy;
    const assigneeId = t.assignee_id ? String(t.assignee_id) : null;
    const meta =
      t.metadata && typeof t.metadata === 'object' && !Array.isArray(t.metadata)
        ? (t.metadata as Record<string, unknown>)
        : null;
    return {
      id: String(t.id),
      task_type: String(t.task_type || ''),
      title: String(t.title || ''),
      status: String(t.status || ''),
      priority: String(t.priority || 'normal'),
      due_at: t.due_at ? String(t.due_at) : null,
      assignee_id: assigneeId,
      assignee_name: assigneeId ? assigneeNames.get(assigneeId) || null : null,
      driver_id: t.driver_id ? String(t.driver_id) : null,
      driver_name: driverRow?.name ? String(driverRow.name) : null,
      conversation_id: t.conversation_id ? String(t.conversation_id) : null,
      pharmacy_name: pharmacy?.trade_name ? String(pharmacy.trade_name) : null,
      signature_status: signatureStatusFromMetadata(meta),
    };
  });
}

async function listOpenTasksForIds(
  db: SupabaseClient,
  workspaceId: string,
  taskIds: string[],
  limit = 80,
  playbooksConfig?: import('./opsTaskConfig').OpsTaskPlaybooksConfig
): Promise<OpsHubTaskRow[]> {
  const unique = Array.from(new Set(taskIds)).slice(0, 200);
  if (!unique.length) return [];

  const { data, error } = await db
    .from('pending_tasks')
    .select(
      `
      id, task_type, title, status, priority, due_at, created_at, assignee_id, driver_id, conversation_id, metadata,
      driver:drivers(id, name),
      conversation:conversations(context_pharmacy:pharmacies!context_pharmacy_id(trade_name))
    `
    )
    .eq('workspace_id', workspaceId)
    .in('id', unique)
    .in('status', ['open', 'in_progress'])
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const assigneeIds = Array.from(
    new Set((data || []).map((t) => t.assignee_id).filter((x): x is string => typeof x === 'string'))
  );
  const assigneeNames = new Map<string, string>();
  if (assigneeIds.length) {
    const { data: users } = await db.from('users').select('id, name').in('id', assigneeIds);
    for (const u of users || []) assigneeNames.set(String(u.id), String(u.name || ''));
  }
  const { enrichTaskRow } = await import('./operacaoHubExtend');
  const rawRows = ((data || []) as Array<Record<string, unknown>>).filter(
    (t) => !PORTFOLIO_HUB_EXCLUDED_TASK_TYPES.has(String(t.task_type || ''))
  );
  return mapTaskRows(rawRows, assigneeNames).map((t, i) => enrichTaskRow(t, rawRows[i], playbooksConfig));
}

async function collectPortfolioTaskIds(
  db: SupabaseClient,
  workspaceId: string,
  attendantUserId: string | null,
  pharmacyIds: string[]
): Promise<string[]> {
  const ids = new Set<string>();

  if (attendantUserId) {
    const { data: mine } = await db
      .from('pending_tasks')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('assignee_id', attendantUserId)
      .in('status', ['open', 'in_progress'])
      .limit(120);
    for (const r of mine || []) ids.add(String(r.id));
  }

  if (pharmacyIds.length) {
    const scope = await loadOperationalDriverScope(db, workspaceId, pharmacyIds);
    const driverIds = Array.from(scope.driverIds).slice(0, 300);
    if (driverIds.length) {
      const { data: byDriver } = await db
        .from('pending_tasks')
        .select('id')
        .eq('workspace_id', workspaceId)
        .in('driver_id', driverIds)
        .in('status', ['open', 'in_progress'])
        .limit(120);
      for (const r of byDriver || []) ids.add(String(r.id));
    }

    const { data: convs } = await db
      .from('conversations')
      .select('id')
      .eq('workspace_id', workspaceId)
      .in('context_pharmacy_id', pharmacyIds)
      .in('status', ['open', 'pending'])
      .limit(400);
    const convIds = (convs || []).map((c) => c.id).filter(Boolean);
    for (let i = 0; i < convIds.length; i += 80) {
      const chunk = convIds.slice(i, i + 80);
      if (!chunk.length) continue;
      const { data: byConv } = await db
        .from('pending_tasks')
        .select('id')
        .eq('workspace_id', workspaceId)
        .in('conversation_id', chunk)
        .in('status', ['open', 'in_progress'])
        .limit(80);
      for (const r of byConv || []) ids.add(String(r.id));
    }
  }

  return Array.from(ids);
}

async function listPortfolioConversations(
  db: SupabaseClient,
  workspaceId: string,
  attendantUserId: string | null,
  pharmacyIds: string[],
  limit = 50
): Promise<OpsHubConversationRow[]> {
  const select = `id, status, priority, updated_at,
    attendant:users!attendant_id(name),
    contact:contacts(display_name),
    context_pharmacy:pharmacies!context_pharmacy_id(trade_name)`;

  const byId = new Map<string, Record<string, unknown>>();

  if (pharmacyIds.length) {
    const { data: byPharmacy } = await db
      .from('conversations')
      .select(select)
      .eq('workspace_id', workspaceId)
      .in('context_pharmacy_id', pharmacyIds)
      .in('status', ['open', 'pending'])
      .order('updated_at', { ascending: false })
      .limit(limit);
    for (const row of byPharmacy || []) byId.set(String(row.id), row as Record<string, unknown>);
  }

  if (attendantUserId) {
    const { data: byAssignee } = await db
      .from('conversations')
      .select(select)
      .eq('workspace_id', workspaceId)
      .eq('attendant_id', attendantUserId)
      .in('status', ['open', 'pending'])
      .order('updated_at', { ascending: false })
      .limit(limit);

    for (const row of byAssignee || []) {
      const id = String(row.id);
      if (!byId.has(id)) byId.set(id, row as Record<string, unknown>);
    }
  }

  const merged = Array.from(byId.values())
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
    .slice(0, limit);
  return mapConversationRows(merged);
}

function mapConversationRows(rows: Array<Record<string, unknown>>): OpsHubConversationRow[] {
  return rows.map((c) => {
    const attendant = c.attendant as { name?: string } | { name?: string }[] | null;
    const contact = c.contact as { display_name?: string } | { display_name?: string }[] | null;
    const pharmacy = c.context_pharmacy as { trade_name?: string } | { trade_name?: string }[] | null;
    const attRow = Array.isArray(attendant) ? attendant[0] : attendant;
    const contactRow = Array.isArray(contact) ? contact[0] : contact;
    const pharmRow = Array.isArray(pharmacy) ? pharmacy[0] : pharmacy;
    return {
      id: String(c.id),
      status: String(c.status || ''),
      priority: String(c.priority || 'normal'),
      pharmacy_name: pharmRow?.trade_name ? String(pharmRow.trade_name) : null,
      contact_name: contactRow?.display_name ? String(contactRow.display_name) : null,
      attendant_name: attRow?.name ? String(attRow.name) : null,
      updated_at: String(c.updated_at || ''),
    };
  });
}

function buildHubNotifications(summary: PortfolioSummary, tasks: OpsHubTaskRow[]): PortfolioAlert[] {
  const out: PortfolioAlert[] = [...summary.alerts];
  const now = Date.now();
  const overdueTasks = tasks.filter((t) => t.due_at && new Date(t.due_at).getTime() < now);
  if (overdueTasks.length) {
    out.unshift({
      severity: 'high',
      type: 'task_overdue',
      message: `${overdueTasks.length} tarefa(s) com prazo estourado na carteira`,
      href: '/operacao',
    });
  }
  return out.slice(0, 16);
}

async function buildOperationsHubForScope(
  db: SupabaseClient,
  workspaceId: string,
  pharmacyIds: string[],
  periodDays: number,
  attendantUserId: string | null,
  opts?: OpsHubQueryOpts
): Promise<OpsOperationsHub> {
  const scopedPharmacyIds = scopePharmacyIds(pharmacyIds, opts?.pharmacyId);
  const {
    alertsToRevive,
    buildComplianceForPharmacies,
    buildKpisFromSummary,
    pharmacyRowsToCards,
    listWorkspaceSignaturePending,
  } = await import('./operacaoHubExtend');
  const { buildCycleEventsForScope } = await import('./operacaoCycleEvents');
  const { loadOpsTaskPlaybooks, loadOpsTaskSlaConfig, signatureDeadlineDays } = await import('./opsTaskConfig');

  const summary = await buildPortfolioSummaryForScope(
    db,
    workspaceId,
    scopedPharmacyIds,
    periodDays,
    attendantUserId
  );
  const taskIds = await collectPortfolioTaskIds(db, workspaceId, attendantUserId, scopedPharmacyIds);
  const [playbooksConfig, slaConfig, conversations, compliance, cycle_events] = await Promise.all([
    loadOpsTaskPlaybooks(db, workspaceId),
    loadOpsTaskSlaConfig(db, workspaceId),
    listPortfolioConversations(db, workspaceId, attendantUserId, scopedPharmacyIds, 50),
    buildComplianceForPharmacies(db, workspaceId, scopedPharmacyIds),
    buildCycleEventsForScope(db, workspaceId, scopedPharmacyIds, periodDays, 80, opts?.referenceDate),
  ]);
  const tasks = await listOpenTasksForIds(db, workspaceId, taskIds, 80, playbooksConfig);
  const notifications = buildHubNotifications(summary, tasks);
  const deadlineByType = Object.fromEntries(
    Object.entries(slaConfig).map(([k, v]) => [k, signatureDeadlineDays(k, slaConfig)])
  );
  return {
    period_days: periodDays,
    reference_date: opts?.referenceDate || null,
    pharmacy_id: opts?.pharmacyId || null,
    summary,
    tasks,
    conversations,
    notifications,
    kpis: buildKpisFromSummary(summary, tasks, conversations),
    pharmacy_cards: pharmacyRowsToCards(summary.pharmacies),
    compliance,
    signature_pending: await listWorkspaceSignaturePending(db, workspaceId, deadlineByType, 50, scopedPharmacyIds),
    alerts_revive: alertsToRevive(summary),
    cycle_events,
  };
}

export async function buildPortfolioOperationsHub(
  db: SupabaseClient,
  workspaceId: string,
  attendantUserId: string,
  periodDays = 30,
  opts?: OpsHubQueryOpts
): Promise<OpsOperationsHub> {
  const rawIds = await getAttendantPortfolioPharmacyIds(db, workspaceId, attendantUserId);
  const pharmacyIds = await filterActivePharmacyIds(db, workspaceId, rawIds);
  return buildOperationsHubForScope(db, workspaceId, pharmacyIds, periodDays, attendantUserId, opts);
}

/** Visão agregada de toda a operação do workspace (gestor operacional · todos). */
export async function buildWorkspaceOperationsHub(
  db: SupabaseClient,
  workspaceId: string,
  periodDays = 30,
  opts?: OpsHubQueryOpts
): Promise<OpsOperationsHub> {
  const pharmacyIds = await getAllWorkspacePharmacyIds(db, workspaceId);
  return buildOperationsHubForScope(db, workspaceId, pharmacyIds, periodDays, null, opts);
}

async function resolveFinanceSectorId(db: SupabaseClient, workspaceId: string): Promise<string | null> {
  const { data } = await db
    .from('sectors')
    .select('id')
    .eq('workspace_id', workspaceId)
    .ilike('name', 'Financeiro')
    .limit(1)
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

export async function buildFinancialOperationsHub(
  db: SupabaseClient,
  workspaceId: string,
  periodDays = 30,
  opts?: OpsHubQueryOpts
): Promise<FinancialOperationsHub> {
  const since = periodSinceIso(periodDays);
  const financeSectorId = await resolveFinanceSectorId(db, workspaceId);

  let taskQuery = db
    .from('pending_tasks')
    .select(
      `
      id, task_type, title, status, priority, due_at, assignee_id, driver_id, conversation_id, metadata,
      driver:drivers(id, name),
      conversation:conversations(context_pharmacy:pharmacies!context_pharmacy_id(trade_name))
    `
    )
    .eq('workspace_id', workspaceId)
    .in('status', ['open', 'in_progress'])
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(100);

  const taskFilters: string[] = [`task_type.in.(${FINANCIAL_TASK_TYPES.join(',')})`];
  if (financeSectorId) taskFilters.push(`sector_id.eq.${financeSectorId}`);
  taskQuery = taskQuery.or(taskFilters.join(','));

  const { data: taskRows, error: taskErr } = await taskQuery;
  if (taskErr) throw new Error(taskErr.message);

  const assigneeIds = Array.from(
    new Set((taskRows || []).map((t) => t.assignee_id).filter((x): x is string => typeof x === 'string'))
  );
  const assigneeNames = new Map<string, string>();
  if (assigneeIds.length) {
    const { data: users } = await db.from('users').select('id, name').in('id', assigneeIds);
    for (const u of users || []) assigneeNames.set(String(u.id), String(u.name || ''));
  }
  const tasks = mapTaskRows((taskRows || []) as Array<Record<string, unknown>>, assigneeNames);

  let convQuery = db
    .from('conversations')
    .select(
      `id, status, priority, updated_at,
      attendant:users!attendant_id(name),
      contact:contacts(display_name),
      context_pharmacy:pharmacies!context_pharmacy_id(trade_name)`
    )
    .eq('workspace_id', workspaceId)
    .in('status', ['open', 'pending'])
    .order('updated_at', { ascending: false })
    .limit(60);
  if (financeSectorId) convQuery = convQuery.eq('sector_id', financeSectorId);
  const { data: convRows } = await convQuery;
  const conversations = mapConversationRows((convRows || []) as Array<Record<string, unknown>>);

  const { count: pendingFinancial } = await db
    .from('financial_entries')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .in('status', ['informed', 'pending_approval', 'active']);

  const { count: pendingAdvances } = await db
    .from('pending_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('task_type', 'financial_advance_request')
    .in('status', ['open', 'in_progress']);

  const nowIso = new Date().toISOString();
  const overdue_tasks = tasks.filter((t) => t.due_at && t.due_at < nowIso).length;

  const { data: funnelRows } = await db
    .from('financial_entries')
    .select('status, type')
    .eq('workspace_id', workspaceId)
    .gte('created_at', since)
    .in('type', ['absence', 'daily', 'advance']);
  const financial_funnel: Record<string, number> = {};
  for (const r of funnelRows || []) {
    const key = `${r.type}:${r.status}`;
    financial_funnel[key] = (financial_funnel[key] || 0) + 1;
  }

  const notifications: PortfolioAlert[] = [];
  if (overdue_tasks > 0) {
    notifications.push({
      severity: 'high',
      type: 'task_overdue',
      message: `${overdue_tasks} tarefa(s) financeiras atrasadas`,
      href: '/operacao',
    });
  }
  if ((pendingAdvances || 0) > 5) {
    notifications.push({
      severity: 'medium',
      type: 'advance_backlog',
      message: `${pendingAdvances} adiantamentos aguardando decisão`,
      href: '/operacao',
    });
  }

  const { enrichTaskRow, alertsToRevive, buildKpisFromSummary } = await import('./operacaoHubExtend');
  const { buildCycleEventsForScope, buildTerminationSettlementAlerts } = await import('./operacaoCycleEvents');
  const { loadOpsTaskPlaybooks } = await import('./opsTaskConfig');
  const playbooksConfig = await loadOpsTaskPlaybooks(db, workspaceId);
  const rawRows = (taskRows || []) as Array<Record<string, unknown>>;
  const enrichedTasks = tasks.map((t, i) => enrichTaskRow(t, rawRows[i], playbooksConfig));
  const fauxSummary: PortfolioSummary = {
    period_days: periodDays,
    totals: {
      pharmacies: 0,
      drivers: 0,
      leaders: 0,
      open_conversations: conversations.length,
      pending_financial: pendingFinancial || 0,
      open_tasks: enrichedTasks.length,
      doc_alerts: 0,
      absences_without_coverage: 0,
    },
    pharmacies: [],
    leaders: [],
    alerts: notifications,
  };

  const pharmacyIds = scopePharmacyIds(await getAllWorkspacePharmacyIds(db, workspaceId), opts?.pharmacyId);
  const { loadOpsTaskSlaConfig, signatureDeadlineDays } = await import('./opsTaskConfig');
  const slaConfigFin = await loadOpsTaskSlaConfig(db, workspaceId);
  const deadlineByTypeFin = Object.fromEntries(
    Object.entries(slaConfigFin).map(([k, v]) => [k, signatureDeadlineDays(k, slaConfigFin)])
  );
  const { listWorkspaceSignaturePending } = await import('./operacaoHubExtend');

  const [cycle_events, settlementAlerts, signature_pending] = await Promise.all([
    buildCycleEventsForScope(db, workspaceId, pharmacyIds, periodDays, 80, opts?.referenceDate),
    buildTerminationSettlementAlerts(db, workspaceId),
    listWorkspaceSignaturePending(db, workspaceId, deadlineByTypeFin, 50, pharmacyIds),
  ]);
  for (const sa of settlementAlerts) {
    notifications.push({
      severity: sa.severity,
      type: sa.type,
      message: sa.message,
      href: '/operacao',
    });
  }

  return {
    period_days: periodDays,
    reference_date: opts?.referenceDate || null,
    pharmacy_id: opts?.pharmacyId || null,
    totals: {
      open_tasks: enrichedTasks.length,
      overdue_tasks,
      open_conversations: conversations.length,
      pending_financial: pendingFinancial || 0,
      pending_advances: pendingAdvances || 0,
    },
    tasks: enrichedTasks,
    conversations,
    notifications,
    financial_funnel,
    kpis: buildKpisFromSummary(fauxSummary, enrichedTasks, conversations).map((k, i) => {
      const overrides = [
        { label: 'Tarefas abertas', value: enrichedTasks.length },
        { label: 'Atrasadas', value: overdue_tasks, alert: overdue_tasks > 0 },
        { label: 'Atendimentos', value: conversations.length },
        { label: 'Lanç. pendentes', value: pendingFinancial || 0 },
        { label: 'Adiantamentos', value: pendingAdvances || 0 },
        { label: 'Funil (tipos)', value: Object.keys(financial_funnel).length },
      ];
      const o = overrides[i];
      return o ? { ...k, label: o.label, value: o.value, alert: o.alert ?? k.alert } : k;
    }),
    alerts_revive: alertsToRevive(fauxSummary),
    cycle_events,
    signature_pending,
  };
}

export type ExecutionBoard = {
  period_days: number;
  reference_date?: string | null;
  pharmacy_id?: string | null;
  kpis: import('./operacaoHubExtend').OpsKpiRow[];
  tasks: OpsHubTaskRow[];
  alerts_revive: import('./operacaoHubExtend').OpsAlertRevive[];
  signature_pending?: import('./operacaoHubExtend').OpsSignaturePending[];
  cycle_events?: import('./operacaoHubExtend').OpsCycleEventRow[];
  summary: { open: number; overdue: number; mine: number };
};

export async function buildExecutionBoard(
  db: SupabaseClient,
  workspaceId: string,
  userId: string,
  sectorIds: string[],
  taskTypes: string[],
  periodDays = 30,
  opts?: OpsHubQueryOpts
): Promise<ExecutionBoard> {
  const { enrichTaskRow, buildKpisFromSummary, listWorkspaceSignaturePending } = await import('./operacaoHubExtend');
  const { buildCycleEventsForScope } = await import('./operacaoCycleEvents');
  const { loadOpsTaskPlaybooks, loadOpsTaskSlaConfig, signatureDeadlineDays } = await import('./opsTaskConfig');
  const { buildAttendantPendingTasksOr } = await import('./pendingTaskScope');
  const [playbooksConfig, slaConfig] = await Promise.all([
    loadOpsTaskPlaybooks(db, workspaceId),
    loadOpsTaskSlaConfig(db, workspaceId),
  ]);
  const deadlineByType = Object.fromEntries(
    Object.entries(slaConfig).map(([k, v]) => [k, signatureDeadlineDays(k, slaConfig)])
  );

  const scopeOr = await buildAttendantPendingTasksOr(db, workspaceId, { sub: userId, sector_ids: sectorIds }, sectorIds);

  const taskSelect = `
      id, task_type, title, status, priority, due_at, created_at, completed_at, assignee_id, driver_id, conversation_id, metadata,
      driver:drivers(id, name, primary_pharmacy_id),
      conversation:conversations(context_pharmacy:pharmacies!context_pharmacy_id(trade_name))
    `;

  const periodSince = new Date();
  periodSince.setDate(periodSince.getDate() - periodDays);

  const statusFilter = String(opts?.status || '').trim();
  const activeStatuses =
    statusFilter && statusFilter !== 'all' && statusFilter !== 'done'
      ? [statusFilter]
      : ['open', 'in_progress'];
  const includeActive = !statusFilter || statusFilter === 'all' || statusFilter !== 'done';
  const includeDone = !statusFilter || statusFilter === 'all' || statusFilter === 'done';

  let activeQuery = includeActive
    ? db
        .from('pending_tasks')
        .select(taskSelect)
        .eq('workspace_id', workspaceId)
        .in('status', activeStatuses)
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(100)
    : null;

  let doneQuery = includeDone
    ? db
        .from('pending_tasks')
        .select(taskSelect)
        .eq('workspace_id', workspaceId)
        .eq('status', 'done')
        .gte('completed_at', periodSince.toISOString())
        .order('completed_at', { ascending: false })
        .limit(100)
    : null;

  const applyBoardFilters = <T extends { eq: (col: string, val: string) => T; gte: (col: string, val: string) => T; lte: (col: string, val: string) => T }>(
    query: T
  ): T => {
    let q = query;
    if (opts?.assigneeId) q = q.eq('assignee_id', opts.assigneeId);
    if (opts?.taskType) q = q.eq('task_type', opts.taskType);
    if (opts?.dateFrom) q = q.gte('created_at', opts.dateFrom);
    if (opts?.dateTo) {
      const end = opts.dateTo.includes('T') ? opts.dateTo : `${opts.dateTo}T23:59:59.999Z`;
      q = q.lte('created_at', end);
    }
    return q;
  };

  if (activeQuery) {
    if (scopeOr) activeQuery = activeQuery.or(scopeOr);
    activeQuery = applyBoardFilters(activeQuery);
  }
  if (doneQuery) {
    if (scopeOr) doneQuery = doneQuery.or(scopeOr);
    doneQuery = applyBoardFilters(doneQuery);
  }

  const [activeResult, doneResult] = await Promise.all([
    activeQuery ? activeQuery : Promise.resolve({ data: [], error: null }),
    doneQuery ? doneQuery : Promise.resolve({ data: [], error: null }),
  ]);
  if (activeResult.error) throw new Error(activeResult.error.message);
  if (doneResult.error) throw new Error(doneResult.error.message);

  const pharmacyId = opts?.pharmacyId;
  const matchesPharmacy = (row: Record<string, unknown>) => {
    if (!pharmacyId) return true;
    const driver = row.driver as { primary_pharmacy_id?: string } | { primary_pharmacy_id?: string }[] | null;
    const driverRow = Array.isArray(driver) ? driver[0] : driver;
    if (driverRow?.primary_pharmacy_id === pharmacyId) return true;
    const meta = (row.metadata || {}) as Record<string, unknown>;
    if (String(meta.pharmacy_id || '') === pharmacyId) return true;
    const ids = meta.pharmacy_ids;
    return Array.isArray(ids) && ids.map(String).includes(pharmacyId);
  };

  const activeRows = (activeResult.data || [])
    .filter((t) => taskTypes.includes(String(t.task_type)))
    .filter((t) => matchesPharmacy(t as Record<string, unknown>));
  const doneRows = (doneResult.data || [])
    .filter((t) => taskTypes.includes(String(t.task_type)))
    .filter((t) => matchesPharmacy(t as Record<string, unknown>));
  const seen = new Set(activeRows.map((t) => String(t.id)));
  const filtered = [...activeRows, ...doneRows.filter((t) => !seen.has(String(t.id)))];
  const assigneeIds = Array.from(
    new Set(filtered.map((t) => t.assignee_id).filter((x): x is string => typeof x === 'string'))
  );
  const assigneeNames = new Map<string, string>();
  if (assigneeIds.length) {
    const { data: users } = await db.from('users').select('id, name').in('id', assigneeIds);
    for (const u of users || []) assigneeNames.set(String(u.id), String(u.name || ''));
  }
  const tasks = mapTaskRows(filtered as Array<Record<string, unknown>>, assigneeNames).map((t, i) =>
    enrichTaskRow(t, filtered[i] as Record<string, unknown>, playbooksConfig)
  );

  const now = Date.now();
  const activeTasks = tasks.filter((t) => t.status === 'open' || t.status === 'in_progress');
  const overdue = activeTasks.filter((t) => t.due_at && new Date(t.due_at).getTime() < now).length;
  const mine = activeTasks.filter((t) => t.assignee_id === userId).length;
  const fauxSummary: PortfolioSummary = {
    period_days: periodDays,
    totals: {
      pharmacies: 0,
      drivers: 0,
      leaders: 0,
      open_conversations: 0,
      pending_financial: 0,
      open_tasks: activeTasks.length,
      doc_alerts: 0,
      absences_without_coverage: 0,
    },
    pharmacies: [],
    leaders: [],
    alerts: [],
  };
  const baseKpis = buildKpisFromSummary(fauxSummary, tasks);
  const kpiOverrides = [
    { label: 'Abertas', value: activeTasks.length },
    { label: 'Atrasadas', value: overdue, alert: overdue > 0 },
    { label: 'Minhas', value: mine },
  ];

  const pharmacyIds = scopePharmacyIds(await getAllWorkspacePharmacyIds(db, workspaceId), opts?.pharmacyId);
  const cycle_events = await buildCycleEventsForScope(
    db,
    workspaceId,
    pharmacyIds,
    periodDays,
    80,
    opts?.referenceDate
  );

  return {
    period_days: periodDays,
    reference_date: opts?.referenceDate || null,
    pharmacy_id: opts?.pharmacyId || null,
    kpis: [
      ...kpiOverrides.map((k, i) => ({
        label: k.label,
        value: k.value,
        alert: k.alert,
        spark: baseKpis[i]?.spark || [0, 0, 0, 0, 0, 0, Number(k.value)],
      })),
    ],
    tasks,
    alerts_revive: overdue
      ? [
          {
            id: 'exec-overdue',
            tipo: 'sla',
            nivel: 'destructive',
            descricao: `${overdue} tarefa(s) com prazo estourado`,
            farmacia: '—',
            timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
            href: '/operacao',
          },
        ]
      : [],
    cycle_events,
    signature_pending: await listWorkspaceSignaturePending(db, workspaceId, deadlineByType, 50, pharmacyIds),
    summary: { open: activeTasks.length, overdue, mine },
  };
}
