import type { SupabaseClient } from '@supabase/supabase-js';
import { SIGNATURE_TRACKED_TASK_TYPES } from '@plataforma/operational-notes';
import { getLeaderManagedPharmacyIds } from './leaderPortalScope';
import { enrichTaskRow, signaturePendingFromTasks, type OpsSignaturePending } from './operacaoHubExtend';
import type { OpsHubTaskRow } from './opsAnalyticsAggregate';
import { loadOpsTaskSlaConfig, signatureDeadlineDays } from './opsTaskConfig';

const LEADER_DASHBOARD_TASK_TYPES = [
  'driver_registration_completion',
  'driver_enrollment_prep',
  'driver_termination_prep',
  'driver_termination_request',
  'driver_doc_expiry_warning',
  'driver_doc_expired',
  'guided_demand',
] as const;

const SIGNATURE_TASK_STATUS_EXCLUDED = new Set(['cancelled', 'canceled', 'archived']);

function isSignatureTaskStatusRelevant(status: unknown): boolean {
  return !SIGNATURE_TASK_STATUS_EXCLUDED.has(String(status || '').trim().toLowerCase());
}

function signatureStatusFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const m = metadata as Record<string, unknown>;
  const raw = m.signature_status ?? m.autentique_status ?? m.document_signature_status;
  return raw != null ? String(raw).trim() || null : null;
}

async function leaderDriverIds(db: SupabaseClient, leaderId: string, workspaceId: string): Promise<string[]> {
  const pharmacyIds = await getLeaderManagedPharmacyIds(db, leaderId, workspaceId);
  if (!pharmacyIds.length) return [];

  const { data: links } = await db
    .from('driver_pharmacy_links')
    .select('driver_id')
    .in('pharmacy_id', pharmacyIds)
    .eq('is_active', true);

  return Array.from(new Set((links || []).map((l) => String(l.driver_id)).filter(Boolean)));
}

function mapTaskRows(
  rows: Array<Record<string, unknown>>,
  assigneeNames: Map<string, string>,
  pharmacyByDriver: Map<string, string>
): OpsHubTaskRow[] {
  return rows.map((t) => {
    const driver = t.driver as { name?: string } | { name?: string }[] | null;
    const driverRow = Array.isArray(driver) ? driver[0] : driver;
    const conv = t.conversation as { context_pharmacy?: { trade_name?: string } } | null;
    const pharmacy = conv?.context_pharmacy;
    const assigneeId = t.assignee_id ? String(t.assignee_id) : null;
    const driverId = t.driver_id ? String(t.driver_id) : null;
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
      driver_id: driverId,
      driver_name: driverRow?.name ? String(driverRow.name) : null,
      conversation_id: t.conversation_id ? String(t.conversation_id) : null,
      pharmacy_name: pharmacy?.trade_name
        ? String(pharmacy.trade_name)
        : driverId
          ? pharmacyByDriver.get(driverId) || null
          : null,
      signature_status: signatureStatusFromMetadata(meta),
    };
  });
}

async function fetchAllLeaderSignatureRows(
  db: SupabaseClient,
  workspaceId: string,
  driverIds: string[]
): Promise<Array<Record<string, unknown>>> {
  const pageSize = 1000;
  const rows: Array<Record<string, unknown>> = [];

  for (let from = 0; ; from += pageSize) {
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
      .in('driver_id', driverIds)
      .in('task_type', [...SIGNATURE_TRACKED_TASK_TYPES])
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);
    rows.push(...(((data || []) as Array<Record<string, unknown>>).filter((row) => isSignatureTaskStatusRelevant(row.status))));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

export type LeaderPortalDashboard = {
  tasks: ReturnType<typeof enrichTaskRow>[];
  pending_signatures: OpsSignaturePending[];
};

export async function fetchLeaderPortalDashboard(
  db: SupabaseClient,
  leaderId: string,
  workspaceId: string
): Promise<LeaderPortalDashboard> {
  const driverIds = await leaderDriverIds(db, leaderId, workspaceId);
  if (!driverIds.length) {
    return { tasks: [], pending_signatures: [] };
  }

  const pharmacyIds = await getLeaderManagedPharmacyIds(db, leaderId, workspaceId);
  const pharmacyByDriver = new Map<string, string>();
  if (pharmacyIds.length) {
    const { data: links } = await db
      .from('driver_pharmacy_links')
      .select('driver_id, pharmacies(trade_name)')
      .in('pharmacy_id', pharmacyIds)
      .eq('is_active', true)
      .eq('is_primary', true);
    for (const l of links || []) {
      const p = l.pharmacies as { trade_name?: string } | { trade_name?: string }[] | null;
      const row = Array.isArray(p) ? p[0] : p;
      if (l.driver_id && row?.trade_name) {
        pharmacyByDriver.set(String(l.driver_id), String(row.trade_name));
      }
    }
  }

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
    .in('driver_id', driverIds)
    .in('status', ['open', 'in_progress'])
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(80);

  if (error) throw new Error(error.message);

  const rawRows = (data || []) as Array<Record<string, unknown>>;
  const dashboardRows = rawRows.filter((t) =>
    LEADER_DASHBOARD_TASK_TYPES.includes(String(t.task_type || '') as (typeof LEADER_DASHBOARD_TASK_TYPES)[number])
  );

  const assigneeIds = Array.from(
    new Set(dashboardRows.map((t) => t.assignee_id).filter((x): x is string => typeof x === 'string'))
  );
  const assigneeNames = new Map<string, string>();
  if (assigneeIds.length) {
    const { data: users } = await db.from('users').select('id, name').in('id', assigneeIds);
    for (const u of users || []) assigneeNames.set(String(u.id), String(u.name || ''));
  }

  const slaConfig = await loadOpsTaskSlaConfig(db, workspaceId);
  const mapped = mapTaskRows(dashboardRows, assigneeNames, pharmacyByDriver);
  const tasks = mapped
    .map((t, i) => enrichTaskRow(t, dashboardRows[i], undefined))
    .slice(0, 6);

  const deadlineByType: Record<string, number> = {};
  for (const type of SIGNATURE_TRACKED_TASK_TYPES) {
    deadlineByType[type] = signatureDeadlineDays(type, slaConfig);
  }

  const signatureRows = await fetchAllLeaderSignatureRows(db, workspaceId, driverIds);
  const signatureDriverIds = signatureRows.map((t) => t.driver_id).filter(Boolean).map(String);
  const settlementOnlyDrivers = new Set<string>();
  if (signatureDriverIds.length) {
    const { data: finRows } = await db
      .from('pending_tasks')
      .select('driver_id, metadata')
      .eq('workspace_id', workspaceId)
      .eq('task_type', 'driver_termination_financial_review')
      .in('driver_id', Array.from(new Set(signatureDriverIds)))
      .in('status', ['open', 'in_progress']);
    for (const row of finRows || []) {
      const meta =
        row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};
      if (String(meta.phase || '') === 'awaiting_settlement' && row.driver_id) {
        settlementOnlyDrivers.add(String(row.driver_id));
      }
    }
  }

  const filteredSignatureRows = signatureRows.filter((t) => !t.driver_id || !settlementOnlyDrivers.has(String(t.driver_id)));
  const signatureMapped = mapTaskRows(filteredSignatureRows, assigneeNames, pharmacyByDriver).map((t, i) => {
    const raw = filteredSignatureRows[i];
    const enriched = enrichTaskRow(t, raw, undefined);
    const metadata =
      raw?.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
        ? (raw.metadata as Record<string, unknown>)
        : {};
    return { ...enriched, metadata };
  });

  const pending_signatures = signaturePendingFromTasks(signatureMapped, deadlineByType);

  return { tasks, pending_signatures };
}
