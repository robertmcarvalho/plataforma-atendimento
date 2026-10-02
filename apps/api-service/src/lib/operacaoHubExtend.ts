import type { SupabaseClient } from '@supabase/supabase-js';
import {
  signatureWorkflowStatusLabel,
  SIGNATURE_TRACKED_TASK_TYPES,
} from '@plataforma/operational-notes';
import { getTaskPlaybook } from './taskPlaybooks';
import type { OpsTaskPlaybooksConfig } from './opsTaskConfig';
import { resolveTaskPlaybook } from './opsTaskConfig';
import type { OpsHubTaskRow, PortfolioPharmacyRow, PortfolioSummary } from './opsAnalyticsAggregate';
import {
  isDocumentSignaturePendingForPanel,
  isEnrollmentDocumentEmitted,
  loadOperationalDriverScope,
  operationalMetaMatchesPharmacyScope,
} from './operationalDriverScope';

export type OpsKpiRow = {
  label: string;
  value: string | number;
  delta?: string;
  delta_tone?: 'up' | 'down' | 'neutral';
  spark: number[];
  alert?: boolean;
};

export type OpsPharmacyCard = {
  id: string;
  trade_name: string;
  city?: string | null;
  leader_id: string | null;
  leader_name: string | null;
  leader_initials: string;
  sla_percent: number;
  drivers_active: number;
  drivers_total: number;
  open_conversations: number;
  pending_financial: number;
};

export type OpsComplianceRow = {
  driver_id: string;
  name: string;
  initials: string;
  pharmacy_name: string;
  cert_digital: boolean;
  mei: boolean;
  matricula_signed: boolean;
};

export type OpsSignaturePending = {
  id: string;
  driver_id: string;
  driver_name: string;
  driver_initials: string;
  pharmacy_name: string;
  type: 'matricula' | 'termo_desligamento';
  signature_status: string | null;
  signature_status_label: string;
  days_pending: number;
  deadline_days: number;
};

const ENROLLMENT_TYPES = new Set([
  'driver_enrollment_prep',
  'driver_registration_completion',
  'driver_enrollment',
]);

const TERMINATION_TYPES = new Set([
  'driver_termination_prep',
  'driver_termination_request',
  'driver_termination_financial_review',
]);

const SIGNATURE_TASK_STATUS_EXCLUDED = new Set(['cancelled', 'canceled', 'archived']);

function isSignatureTaskStatusRelevant(status: unknown): boolean {
  return !SIGNATURE_TASK_STATUS_EXCLUDED.has(String(status || '').trim().toLowerCase());
}

export type OpsAlertRevive = {
  id: string;
  tipo: string;
  nivel: 'destructive' | 'warning' | 'success' | 'info';
  descricao: string;
  farmacia: string;
  timestamp: string;
  href?: string;
};

export type OpsCycleEventRow = {
  id: string;
  tipo: 'entrada' | 'desligamento';
  driver_id?: string;
  driver_name: string;
  driver_initials: string;
  data: string;
  effective_date?: string;
  pharmacy_id?: string;
  pharmacy_name: string;
  leader_name: string;
  attendant_name: string;
  status: 'concluido' | 'em_andamento' | 'pendente';
  substitution_risk?: boolean;
  termination_signature_status?: string | null;
  termination_signature_label?: string | null;
  settlement_due_at?: string | null;
  settlement_days_remaining?: number | null;
};

function initials(name: string): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function enrichTaskRow(
  row: OpsHubTaskRow,
  raw?: Record<string, unknown>,
  playbooksConfig?: OpsTaskPlaybooksConfig
): OpsHubTaskRow & {
  checklist: Array<{ label: string; done: boolean }>;
  sla_minutes: number | null;
  elapsed_minutes: number | null;
  prazo_label: string | null;
  driver_initials: string;
  created_at: string | null;
} {
  const meta =
    raw?.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
      ? (raw.metadata as Record<string, unknown>)
      : {};
  const pb = playbooksConfig
    ? resolveTaskPlaybook(row.task_type, playbooksConfig, meta)
    : getTaskPlaybook(row.task_type, meta);
  let checklist: Array<{ label: string; done: boolean }> = [];
  const progress = meta.playbook_progress;
  if (Array.isArray(progress)) {
    checklist = progress
      .filter((x) => x && typeof x === 'object')
      .map((x) => {
        const item = x as { label?: string; done?: boolean };
        return { label: String(item.label || ''), done: Boolean(item.done) };
      })
      .filter((x) => x.label);
  } else {
    checklist = pb.steps.map((s) => ({ label: s.label, done: Boolean(s.done) }));
  }

  const created = raw?.created_at ? new Date(String(raw.created_at)).getTime() : null;
  const due = row.due_at ? new Date(row.due_at).getTime() : null;
  const now = Date.now();
  const slaMinutes = created && due ? Math.max(1, Math.round((due - created) / 60000)) : null;
  const elapsedMinutes = created ? Math.max(0, Math.round((now - created) / 60000)) : null;
  const prazoLabel = row.due_at
    ? new Date(row.due_at).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;

  return {
    ...row,
    checklist,
    sla_minutes: slaMinutes,
    elapsed_minutes: elapsedMinutes,
    prazo_label: prazoLabel,
    driver_initials: initials(row.driver_name || ''),
    created_at: raw?.created_at ? String(raw.created_at) : null,
  };
}

function buildDailySpark(timestamps: string[], fallback: number): number[] {
  const buckets = Array(7).fill(0);
  const now = Date.now();
  for (const ts of timestamps) {
    const t = new Date(ts).getTime();
    if (Number.isNaN(t)) continue;
    const dayDiff = Math.floor((now - t) / 86400000);
    if (dayDiff >= 0 && dayDiff < 7) buckets[6 - dayDiff] += 1;
  }
  if (buckets.every((v) => v === 0)) {
    return Array.from({ length: 7 }, (_, i) => Math.max(0, fallback - Math.max(0, 6 - i)));
  }
  return buckets;
}

export function buildKpisFromSummary(
  summary: PortfolioSummary,
  tasks: Array<OpsHubTaskRow & { created_at?: string | null }>,
  conversations?: Array<{ updated_at: string }>
): OpsKpiRow[] {
  const taskDates = tasks.map((t) => t.created_at).filter(Boolean) as string[];
  const convDates = (conversations || []).map((c) => c.updated_at).filter(Boolean);
  return [
    {
      label: 'Farmácias',
      value: summary.totals.pharmacies,
      spark: buildDailySpark([], summary.totals.pharmacies),
    },
    {
      label: 'Tarefas abertas',
      value: tasks.length,
      alert: tasks.length > 10,
      spark: buildDailySpark(taskDates, tasks.length),
    },
    {
      label: 'Atendimentos',
      value: summary.totals.open_conversations,
      spark: buildDailySpark(convDates, summary.totals.open_conversations),
    },
    {
      label: 'Pend. financeiras',
      value: summary.totals.pending_financial,
      alert: summary.totals.pending_financial > 0,
      spark: buildDailySpark([], summary.totals.pending_financial),
    },
    {
      label: 'Docs a vencer',
      value: summary.totals.doc_alerts,
      alert: summary.totals.doc_alerts > 0,
      spark: buildDailySpark([], summary.totals.doc_alerts),
    },
    {
      label: 'Faltas s/ cobertura',
      value: summary.totals.absences_without_coverage,
      alert: summary.totals.absences_without_coverage > 0,
      spark: buildDailySpark([], summary.totals.absences_without_coverage),
    },
  ];
}

export function pharmacyRowsToCards(rows: PortfolioPharmacyRow[]): OpsPharmacyCard[] {
  return rows.map((p) => ({
    id: p.id,
    trade_name: p.trade_name,
    city: null,
    leader_id: p.leader_id,
    leader_name: p.leader_name,
    leader_initials: initials(p.leader_name || 'L'),
    sla_percent: p.sla_percent,
    drivers_active: p.drivers_count,
    drivers_total: p.drivers_count,
    open_conversations: p.open_conversations,
    pending_financial: p.pending_financial,
  }));
}

export async function buildComplianceForPharmacies(
  db: SupabaseClient,
  workspaceId: string,
  pharmacyIds: string[],
  limit = 200
): Promise<OpsComplianceRow[]> {
  if (!pharmacyIds.length) return [];

  const scope = await loadOperationalDriverScope(db, workspaceId, pharmacyIds);
  const driverIds = Array.from(scope.driverIds);
  if (!driverIds.length) return [];

  const { data: pharmacyRows, error: pharmErr } = await db
    .from('pharmacies')
    .select('id, trade_name')
    .eq('workspace_id', workspaceId)
    .in('id', pharmacyIds);
  if (pharmErr) throw new Error(pharmErr.message);

  const pharmNameById = new Map(
    (pharmacyRows || []).map((p) => [String(p.id), String(p.trade_name || '')])
  );

  const pharmByDriver = new Map<string, string>();
  for (const [driverId, ids] of scope.pharmacyIdsByDriver) {
    const first = ids.find((id) => pharmacyIds.includes(id)) || ids[0];
    if (first) pharmByDriver.set(driverId, pharmNameById.get(first) || '—');
  }

  const matriculaSigned = new Set<string>();
  const batchSize = 100;
  for (let i = 0; i < driverIds.length; i += batchSize) {
    const batch = driverIds.slice(i, i + batchSize);
    const { data: enrollmentTasks, error: taskErr } = await db
      .from('pending_tasks')
      .select('driver_id, status, metadata')
      .eq('workspace_id', workspaceId)
      .in('driver_id', batch)
      .in('task_type', [...ENROLLMENT_TYPES])
      .order('updated_at', { ascending: false });
    if (taskErr) throw new Error(taskErr.message);
    for (const t of enrollmentTasks || []) {
      const did = t.driver_id ? String(t.driver_id) : '';
      if (!did || matriculaSigned.has(did)) continue;
      const meta = (t.metadata || {}) as Record<string, unknown>;
      if (isEnrollmentDocumentEmitted(meta)) matriculaSigned.add(did);
    }
  }

  const rows: OpsComplianceRow[] = [];
  for (let i = 0; i < driverIds.length && rows.length < limit; i += batchSize) {
    const batch = driverIds.slice(i, i + batchSize);
    const { data: drivers, error: drvErr } = await db
      .from('drivers')
      .select('id, name, has_digital_certificate, is_mei, doc_status')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .in('id', batch)
      .order('name');
    if (drvErr) throw new Error(drvErr.message);

    for (const d of drivers || []) {
      if (rows.length >= limit) break;
      const id = String(d.id);
      rows.push({
        driver_id: id,
        name: String(d.name || ''),
        initials: initials(String(d.name || '')),
        pharmacy_name: pharmByDriver.get(id) || '—',
        cert_digital: Boolean(d.has_digital_certificate),
        mei: Boolean(d.is_mei),
        matricula_signed: matriculaSigned.has(id),
      });
    }
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export function signaturePendingFromTasks(
  tasks: Array<OpsHubTaskRow & { created_at?: string | null; metadata?: Record<string, unknown> | null }>,
  deadlineByType?: Record<string, number>
): OpsSignaturePending[] {
  const now = Date.now();
  return tasks
    .filter((t) => {
      const meta = t.metadata || {};
      return isDocumentSignaturePendingForPanel(meta);
    })
    .map((t, i) => {
      const meta = t.metadata || {};
      const created = t.created_at ? new Date(t.created_at).getTime() : now - 86400000;
      const days_pending = Math.max(1, Math.floor((now - created) / 86400000));
      const deadline_days = deadlineByType?.[t.task_type] ?? 5;
      const status = t.signature_status || String(meta.signature_status || 'awaiting_document');
      return {
        id: t.id || `sig-${i}`,
        driver_id: t.driver_id || '',
        driver_name: t.driver_name || 'Entregador',
        driver_initials: initials(t.driver_name || ''),
        pharmacy_name: t.pharmacy_name || '—',
        type: t.task_type.includes('termination') ? ('termo_desligamento' as const) : ('matricula' as const),
        signature_status: status,
        signature_status_label: signatureWorkflowStatusLabel(meta),
        days_pending,
        deadline_days,
      };
    });
}

/** Pendências de assinatura em todo o workspace (independente de assignee do board). */
export async function listWorkspaceSignaturePending(
  db: SupabaseClient,
  workspaceId: string,
  deadlineByType?: Record<string, number>,
  limit = 50,
  pharmacyIds?: string[]
): Promise<OpsSignaturePending[]> {
  let scopedDriverIds: Set<string> | null = null;
  if (pharmacyIds) {
    if (!pharmacyIds.length) return [];
    const scope = await loadOperationalDriverScope(db, workspaceId, pharmacyIds);
    scopedDriverIds = scope.driverIds;
    if (!scopedDriverIds.size) return [];
  }

  const queryLimit = scopedDriverIds ? Math.max(limit * 5, 200) : limit;
  const { data, error } = await db
    .from('pending_tasks')
    .select(
      `id, task_type, status, created_at, driver_id, metadata,
      driver:drivers(id, name),
      conversation:conversations(context_pharmacy:pharmacies!context_pharmacy_id(trade_name))`
    )
    .eq('workspace_id', workspaceId)
    .in('task_type', [...SIGNATURE_TRACKED_TASK_TYPES])
    .order('created_at', { ascending: true })
    .limit(queryLimit);
  if (error) throw new Error(error.message);

  const rows = (data || []) as Array<Record<string, unknown>>;
  const mapped: Array<OpsHubTaskRow & { created_at?: string | null; metadata?: Record<string, unknown> | null }> =
    rows
      .filter((raw) => {
        const meta =
          raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
            ? (raw.metadata as Record<string, unknown>)
            : {};
        if (!isSignatureTaskStatusRelevant(raw.status)) return false;
        if (scopedDriverIds) {
          const driverId = raw.driver_id ? String(raw.driver_id) : '';
          if (
            (!driverId || !scopedDriverIds.has(driverId)) &&
            !operationalMetaMatchesPharmacyScope(meta, pharmacyIds || [])
          ) {
            return false;
          }
        }
        return isDocumentSignaturePendingForPanel(meta);
      })
      .map((raw) => {
        const driver = raw.driver as { name?: string } | { name?: string }[] | null;
        const driverRow = Array.isArray(driver) ? driver[0] : driver;
        const conv = raw.conversation as { context_pharmacy?: { trade_name?: string } } | null;
        const meta =
          raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
            ? (raw.metadata as Record<string, unknown>)
            : {};
        return {
          id: String(raw.id),
          task_type: String(raw.task_type || ''),
          title: '',
          status: String(raw.status || ''),
          priority: 'normal',
          due_at: null,
          assignee_id: null,
          assignee_name: null,
          driver_id: raw.driver_id ? String(raw.driver_id) : null,
          driver_name: driverRow?.name ? String(driverRow.name) : null,
          conversation_id: null,
          pharmacy_name: conv?.context_pharmacy?.trade_name
            ? String(conv.context_pharmacy.trade_name)
            : '—',
          signature_status: String(meta.signature_status || '') || null,
          created_at: raw.created_at ? String(raw.created_at) : null,
          metadata: meta,
        };
      });

  const driverIds = mapped.map((t) => t.driver_id).filter(Boolean) as string[];
  const settlementOnlyDrivers = new Set<string>();
  if (driverIds.length) {
    const { data: finRows } = await db
      .from('pending_tasks')
      .select('driver_id, metadata')
      .eq('workspace_id', workspaceId)
      .eq('task_type', 'driver_termination_financial_review')
      .in('driver_id', driverIds)
      .in('status', ['open', 'in_progress']);
    for (const row of finRows || []) {
      const meta = (row.metadata || {}) as Record<string, unknown>;
      if (String(meta.phase || '') === 'awaiting_settlement' && row.driver_id) {
        settlementOnlyDrivers.add(String(row.driver_id));
      }
    }
  }

  const filtered = mapped.filter((t) => !t.driver_id || !settlementOnlyDrivers.has(t.driver_id));
  return signaturePendingFromTasks(filtered, deadlineByType).slice(0, limit);
}

function cycleStatusFromTask(status: string): OpsCycleEventRow['status'] {
  if (status === 'done') return 'concluido';
  if (status === 'open') return 'pendente';
  return 'em_andamento';
}

export function buildCycleEventsFromTasks(
  tasks: Array<OpsHubTaskRow & { created_at?: string | null }>,
  limit = 40
): OpsCycleEventRow[] {
  const events: OpsCycleEventRow[] = [];
  for (const t of tasks) {
    const tipo = ENROLLMENT_TYPES.has(t.task_type)
      ? ('entrada' as const)
      : TERMINATION_TYPES.has(t.task_type)
        ? ('desligamento' as const)
        : null;
    if (!tipo) continue;
    const created = t.created_at ? new Date(t.created_at) : new Date();
    events.push({
      id: `cycle-${t.id}`,
      tipo,
      driver_name: t.driver_name || 'Entregador',
      driver_initials: initials(t.driver_name || ''),
      data: created.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      pharmacy_name: t.pharmacy_name || '—',
      leader_name: '—',
      attendant_name: t.assignee_name || '—',
      status: cycleStatusFromTask(t.status),
    });
  }
  return events.slice(0, limit);
}

export function alertsToRevive(summary: PortfolioSummary): OpsAlertRevive[] {
  return summary.alerts.map((a, i) => ({
    id: `alert-${i}`,
    tipo: a.type,
    nivel:
      a.severity === 'high' ? 'destructive' : a.severity === 'medium' ? 'warning' : ('info' as const),
    descricao: a.message,
    farmacia: '—',
    timestamp: new Date().toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    href: a.href,
  }));
}
