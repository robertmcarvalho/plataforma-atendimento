import type { SupabaseClient } from '@supabase/supabase-js';
import { weekBoundsMonSun } from '@plataforma/financial-cycle';
import { isSignatureSignedStatus, signatureWorkflowStatusLabel } from '@plataforma/operational-notes';
import type { OpsCycleEventRow } from './operacaoHubExtend';
import {
  loadOperationalDriverScope,
  operationalMetaMatchesPharmacyScope,
  pharmacyIdsFromOperationalMeta,
  type OperationalDriverScope,
} from './operationalDriverScope';

const ENROLLMENT_TYPES = new Set([
  'driver_enrollment_prep',
  'driver_registration_completion',
  'driver_enrollment',
]);

const TERMINATION_PREP_TYPES = new Set(['driver_termination_prep', 'driver_termination_request']);

const TERMINATION_PIPELINE_TYPES = [
  'driver_termination_prep',
  'driver_termination_request',
  'driver_termination_financial_review',
] as const;

const CYCLE_TASK_TYPES = [...ENROLLMENT_TYPES, ...TERMINATION_PREP_TYPES];

type TaskRow = Record<string, unknown> & {
  id: string;
  task_type: string;
  status: string;
  created_at?: string | null;
  completed_at?: string | null;
  assignee_id?: string | null;
  driver_id?: string | null;
  metadata?: unknown;
  driver?: { name?: string } | { name?: string }[] | null;
  assignee?: { name?: string } | { name?: string }[] | null;
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

function formatPtDate(isoDate: string): string {
  const raw = String(isoDate || '').trim();
  if (!raw) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00`) : new Date(raw);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function cycleDisplayDate(
  meta: Record<string, unknown>,
  tipo: 'entrada' | 'desligamento',
  fallbackIso: string
): { label: string; effectiveIso: string } {
  const lastWorked = String(meta.last_worked_at || '').trim();
  const opStarted = String(meta.operation_started_at || '').trim();
  if (tipo === 'desligamento' && lastWorked) {
    return { label: formatPtDate(lastWorked), effectiveIso: `${lastWorked}T12:00:00.000Z` };
  }
  if (tipo === 'entrada' && opStarted) {
    return { label: formatPtDate(opStarted), effectiveIso: `${opStarted}T12:00:00.000Z` };
  }
  const fallback = fallbackIso ? new Date(fallbackIso) : new Date();
  return {
    label: fallback.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
    effectiveIso: fallback.toISOString(),
  };
}

function cycleStatusFromTask(status: string): OpsCycleEventRow['status'] {
  if (status === 'done') return 'concluido';
  if (status === 'open') return 'pendente';
  return 'em_andamento';
}

function periodSinceIso(periodDays: number, referenceDate?: string): string {
  const ref = referenceDate?.trim()
    ? new Date(`${referenceDate.trim()}T12:00:00.000Z`)
    : new Date();
  const d = new Date(ref);
  d.setDate(d.getDate() - periodDays);
  return d.toISOString();
}

function operativeWeekBounds(referenceDate?: string): { startDate: string; endDate: string } {
  const ref = referenceDate?.trim() || new Date().toISOString().slice(0, 10);
  return weekBoundsMonSun(ref);
}

function businessDaysRemaining(untilIso: string | null | undefined): number | null {
  if (!untilIso) return null;
  const end = new Date(untilIso).getTime();
  const now = Date.now();
  if (end <= now) return 0;
  let cursor = new Date(now);
  let days = 0;
  while (cursor.getTime() < end && days < 500) {
    cursor = new Date(cursor.getTime() + 86400000);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) days++;
  }
  return days;
}

function taskMeta(raw: TaskRow): Record<string, unknown> {
  return raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
    ? (raw.metadata as Record<string, unknown>)
    : {};
}

const TERMINATION_OPS_FIELDS = ['leader_id', 'leader_name', 'last_worked_at', 'termination_reason'] as const;

/** Finanças sobrescreve metadata, mas não deve apagar líder/data vindos da prep operacional. */
function mergeTerminationPipelineMeta(
  prepMeta: Record<string, unknown>,
  finMeta: Record<string, unknown>
): Record<string, unknown> {
  const merged = { ...prepMeta, ...finMeta };
  for (const key of TERMINATION_OPS_FIELDS) {
    const finVal = finMeta[key];
    const prepVal = prepMeta[key];
    if ((finVal === null || finVal === undefined || finVal === '') && prepVal) {
      merged[key] = prepVal;
    }
  }
  return merged;
}

function terminationSignatureMeta(
  ...candidates: Array<Record<string, unknown>>
): Record<string, unknown> {
  for (const meta of candidates) {
    const status = String(meta.termination_signature_status || meta.signature_status || '').trim();
    if (isSignatureSignedStatus(status)) return meta;
  }
  return candidates.find((m) => Object.keys(m).length > 0) || {};
}

const PIPELINE_TASK_SELECT = `
  id, task_type, status, created_at, completed_at, assignee_id, driver_id, due_at, metadata,
  driver:drivers(id, name),
  assignee:users!assignee_id(name)
`;

function rowDriver(raw: TaskRow): { name?: string } | null {
  const driver = raw.driver;
  if (Array.isArray(driver)) return driver[0] || null;
  return driver || null;
}

function rowAssignee(raw: TaskRow): { name?: string } | null {
  const assignee = raw.assignee;
  if (Array.isArray(assignee)) return assignee[0] || null;
  return assignee || null;
}

function pharmacyIdsFromMeta(meta: Record<string, unknown>): string[] {
  return pharmacyIdsFromOperationalMeta(meta);
}

function pharmacyMatchesScope(meta: Record<string, unknown>, pharmacyIds: string[]): boolean {
  return operationalMetaMatchesPharmacyScope(meta, pharmacyIds);
}

function eventDateInOperativeWeek(atIso: string, week: { startDate: string; endDate: string }): boolean {
  const day = atIso.slice(0, 10);
  return day >= week.startDate && day <= week.endDate;
}

function markSubstitutionRisks(events: OpsCycleEventRow[], windowDays = 14): OpsCycleEventRow[] {
  const byPharmacy = new Map<string, OpsCycleEventRow[]>();
  for (const e of events) {
    if (!e.pharmacy_id) continue;
    const list = byPharmacy.get(e.pharmacy_id) || [];
    list.push(e);
    byPharmacy.set(e.pharmacy_id, list);
  }

  const riskyIds = new Set<string>();
  for (const group of byPharmacy.values()) {
    const doneTerm = group.filter((e) => e.tipo === 'desligamento' && e.status === 'concluido');
    const doneEntry = group.filter((e) => e.tipo === 'entrada' && e.status === 'concluido');
    for (const term of doneTerm) {
      const termDate = term.effective_date ? new Date(term.effective_date).getTime() : 0;
      for (const ent of doneEntry) {
        if (term.driver_id && ent.driver_id && term.driver_id === ent.driver_id) continue;
        const entDate = ent.effective_date ? new Date(ent.effective_date).getTime() : 0;
        const diffDays = Math.abs(entDate - termDate) / 86400000;
        if (diffDays <= windowDays) {
          riskyIds.add(term.id);
          riskyIds.add(ent.id);
        }
      }
    }
  }

  return events.map((e) => (riskyIds.has(e.id) ? { ...e, substitution_risk: true } : e));
}

export async function buildCycleEventsForScope(
  db: SupabaseClient,
  workspaceId: string,
  pharmacyIds: string[],
  periodDays = 30,
  limit = 80,
  referenceDate?: string
): Promise<OpsCycleEventRow[]> {
  const since = periodSinceIso(periodDays, referenceDate);
  const operativeWeek = operativeWeekBounds(referenceDate);

  const { data: pipelineRows, error: pipelineErr } = await db
    .from('pending_tasks')
    .select(PIPELINE_TASK_SELECT)
    .eq('workspace_id', workspaceId)
    .in('task_type', [...TERMINATION_PIPELINE_TYPES])
    .in('status', ['open', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(200);
  if (pipelineErr) throw new Error(pipelineErr.message);

  let driverIdsInScope: Set<string> | null = null;
  let driverScope: OperationalDriverScope | null = null;
  if (pharmacyIds.length) {
    driverScope = await loadOperationalDriverScope(db, workspaceId, pharmacyIds);
    driverIdsInScope = driverScope.driverIds;
  }

  const pharmacyNameCache = new Map<string, string>();
  const leaderNameCache = new Map<string, string>();

  async function pharmacyName(id: string): Promise<string> {
    if (pharmacyNameCache.has(id)) return pharmacyNameCache.get(id)!;
    const { data } = await db
      .from('pharmacies')
      .select('id, trade_name, leader_id, leader:leaders(name)')
      .eq('id', id)
      .maybeSingle();
    const name = String(data?.trade_name || '—');
    pharmacyNameCache.set(id, name);
    const leader = data?.leader as { name?: string } | null;
    if (data?.leader_id) {
      leaderNameCache.set(String(data.leader_id), String(leader?.name || '—'));
    }
    return name;
  }

  const events: OpsCycleEventRow[] = [];
  const terminationDriversDone = new Set<string>();

  const pipelineByDriver = new Map<
    string,
    { prep?: TaskRow; fin?: TaskRow; request?: TaskRow }
  >();
  for (const raw of (pipelineRows || []) as TaskRow[]) {
    const driverId = raw.driver_id ? String(raw.driver_id) : '';
    if (!driverId) continue;
    const meta = taskMeta(raw);
    if (
      pharmacyIds.length &&
      !pharmacyMatchesScope(meta, pharmacyIds) &&
      !driverIdsInScope?.has(driverId)
    ) {
      continue;
    }

    const bucket = pipelineByDriver.get(driverId) || {};
    const type = String(raw.task_type || '');
    if (type === 'driver_termination_financial_review') bucket.fin = raw;
    else if (type === 'driver_termination_request') bucket.request = raw;
    else if (type === 'driver_termination_prep') bucket.prep = raw;
    pipelineByDriver.set(driverId, bucket);
  }

  const missingPrepIds: string[] = [];
  for (const bucket of pipelineByDriver.values()) {
    if (bucket.fin && !bucket.prep && !bucket.request) {
      const opId = String(taskMeta(bucket.fin).operational_task_id || '').trim();
      if (opId) missingPrepIds.push(opId);
    }
  }
  if (missingPrepIds.length) {
    const { data: prepRows, error: prepErr } = await db
      .from('pending_tasks')
      .select(PIPELINE_TASK_SELECT)
      .eq('workspace_id', workspaceId)
      .in('id', missingPrepIds);
    if (prepErr) throw new Error(prepErr.message);
    for (const raw of (prepRows || []) as TaskRow[]) {
      const driverId = raw.driver_id ? String(raw.driver_id) : '';
      if (!driverId) continue;
      const bucket = pipelineByDriver.get(driverId) || {};
      const type = String(raw.task_type || '');
      if (type === 'driver_termination_prep') bucket.prep = raw;
      else if (type === 'driver_termination_request') bucket.request = raw;
      pipelineByDriver.set(driverId, bucket);
    }
  }

  for (const [driverId, bucket] of pipelineByDriver) {
    const primary = bucket.prep || bucket.request || bucket.fin;
    if (!primary) continue;

    const prepMeta = taskMeta(bucket.prep || bucket.request || primary);
    const finMeta = bucket.fin ? taskMeta(bucket.fin) : {};
    const mergedMeta = mergeTerminationPipelineMeta(prepMeta, finMeta);

    const pharmIds = pharmacyIdsFromMeta(mergedMeta);
    const pharmacyId = pharmIds[0] || '';
    const driverRow = rowDriver(bucket.prep || bucket.fin || primary);
    const analystRow = rowAssignee(bucket.prep || bucket.request || primary);

    const atIso = String(
      bucket.prep?.created_at ||
        bucket.request?.created_at ||
        bucket.fin?.created_at ||
        primary.created_at ||
        ''
    );
    const display = cycleDisplayDate(mergedMeta, 'desligamento', atIso);
    if (!eventDateInOperativeWeek(display.effectiveIso, operativeWeek)) continue;

    const fallbackPharmacyId = pharmacyId || driverScope?.pharmacyIdsByDriver.get(driverId)?.[0] || '';
    const pharmName = fallbackPharmacyId ? await pharmacyName(fallbackPharmacyId) : '—';
    const leaderId = String(mergedMeta.leader_id || '');
    let leaderName = leaderId && leaderNameCache.has(leaderId) ? leaderNameCache.get(leaderId)! : '—';
    if (leaderName === '—' && mergedMeta.leader_name) leaderName = String(mergedMeta.leader_name);

    const sigMeta = terminationSignatureMeta(prepMeta, finMeta);
    const sigStatus = String(sigMeta.termination_signature_status || sigMeta.signature_status || '') || null;
    const sigLabel = sigStatus ? signatureWorkflowStatusLabel(sigMeta) : null;
    const settlementDue =
      String(finMeta.settlement_due_at || bucket.fin?.due_at || prepMeta.settlement_due_at || '') || null;

    const hasOpenSettlement = Boolean(bucket.fin);
    const status = hasOpenSettlement
      ? 'em_andamento'
      : cycleStatusFromTask(String((bucket.prep || bucket.request || primary).status || ''));

    const sourceId = bucket.prep?.id || bucket.request?.id || bucket.fin?.id || primary.id;

    events.push({
      id: `cycle-${sourceId}`,
      tipo: 'desligamento',
      driver_id: driverId,
      driver_name: String(driverRow?.name || mergedMeta.driver_name || 'Entregador'),
      driver_initials: initials(String(driverRow?.name || mergedMeta.driver_name || '')),
      data: display.label,
      effective_date: display.effectiveIso,
      pharmacy_id: fallbackPharmacyId || undefined,
      pharmacy_name: pharmName,
      leader_name: leaderName,
      attendant_name: String(analystRow?.name || '—'),
      status,
      termination_signature_status: sigStatus,
      termination_signature_label: sigLabel,
      settlement_due_at: settlementDue,
      settlement_days_remaining: businessDaysRemaining(settlementDue),
    });
    terminationDriversDone.add(driverId);
  }

  const { data: rows, error } = await db
    .from('pending_tasks')
    .select(
      `
      id, task_type, status, created_at, completed_at, assignee_id, driver_id, metadata,
      driver:drivers(id, name),
      assignee:users!assignee_id(name)
    `
    )
    .eq('workspace_id', workspaceId)
    .in('task_type', [...CYCLE_TASK_TYPES])
    .in('status', ['open', 'in_progress', 'done'])
    .order('created_at', { ascending: false })
    .limit(Math.min(limit * 3, 250));
  if (error) throw new Error(error.message);

  for (const raw of (rows || []) as TaskRow[]) {
    if (events.length >= limit) break;

    const taskType = String(raw.task_type || '');
    const tipo = ENROLLMENT_TYPES.has(taskType)
      ? ('entrada' as const)
      : TERMINATION_PREP_TYPES.has(taskType)
        ? ('desligamento' as const)
        : null;
    if (!tipo) continue;

    const driverId = raw.driver_id ? String(raw.driver_id) : '';
    if (tipo === 'desligamento' && driverId && terminationDriversDone.has(driverId)) continue;

    const atIso = String(raw.completed_at || raw.created_at || '');
    const meta = taskMeta(raw);

    if (atIso && atIso < since) {
      continue;
    }

    if (
      pharmacyIds.length &&
      !pharmacyMatchesScope(meta, pharmacyIds) &&
      (!driverId || !driverIdsInScope?.has(driverId))
    ) {
      continue;
    }

    let pharmacyId = pharmacyIdsFromMeta(meta)[0] || driverScope?.pharmacyIdsByDriver.get(driverId)?.[0] || '';
    const driverRow = rowDriver(raw);
    const assigneeRow = rowAssignee(raw);

    const display = cycleDisplayDate(meta, tipo, atIso);
    if (!eventDateInOperativeWeek(display.effectiveIso, operativeWeek)) continue;

    const pharmName = pharmacyId ? await pharmacyName(pharmacyId) : '—';
    const leaderId = String(meta.leader_id || '');
    let leaderName = leaderId && leaderNameCache.has(leaderId) ? leaderNameCache.get(leaderId)! : '—';
    if (leaderName === '—' && meta.leader_name) leaderName = String(meta.leader_name);

    const sigStatus =
      tipo === 'desligamento'
        ? String(meta.termination_signature_status || meta.signature_status || '') || null
        : tipo === 'entrada'
          ? String(meta.signature_status || '') || null
          : null;
    const sigLabel =
      tipo === 'desligamento' || tipo === 'entrada'
        ? sigStatus
          ? signatureWorkflowStatusLabel(meta)
          : null
        : null;
    const settlementDue =
      tipo === 'desligamento' && meta.settlement_due_at ? String(meta.settlement_due_at) : null;

    events.push({
      id: `cycle-${raw.id}`,
      tipo,
      driver_id: driverId || undefined,
      driver_name: String(driverRow?.name || meta.driver_name || 'Entregador'),
      driver_initials: initials(String(driverRow?.name || meta.driver_name || '')),
      data: display.label,
      effective_date: display.effectiveIso,
      pharmacy_id: pharmacyId || undefined,
      pharmacy_name: pharmName,
      leader_name: leaderName,
      attendant_name: String(assigneeRow?.name || '—'),
      status: cycleStatusFromTask(String(raw.status || '')),
      termination_signature_status: sigStatus,
      termination_signature_label: sigLabel,
      settlement_due_at: settlementDue,
      settlement_days_remaining: businessDaysRemaining(settlementDue),
    });
  }

  return markSubstitutionRisks(
    events.sort((a, b) => (b.effective_date || '').localeCompare(a.effective_date || '')).slice(0, limit)
  );
}

export async function buildTerminationSettlementAlerts(
  db: SupabaseClient,
  workspaceId: string
): Promise<Array<{ severity: 'high' | 'medium'; type: string; message: string }>> {
  const now = Date.now();
  const { data: finTasks } = await db
    .from('pending_tasks')
    .select('id, metadata, due_at, driver:drivers(name)')
    .eq('workspace_id', workspaceId)
    .eq('task_type', 'driver_termination_financial_review')
    .in('status', ['open', 'in_progress'])
    .limit(100);

  const alerts: Array<{ severity: 'high' | 'medium'; type: string; message: string }> = [];
  for (const t of finTasks || []) {
    const meta = (t.metadata || {}) as Record<string, unknown>;
    const phase = String(meta.phase || '');
    const driver = t.driver as { name?: string } | { name?: string }[] | null;
    const driverRow = Array.isArray(driver) ? driver[0] : driver;
    const name = String(driverRow?.name || meta.driver_name || 'Entregador');

    if (phase === 'awaiting_signature') {
      alerts.push({
        severity: 'medium',
        type: 'awaiting_signature',
        message: `${name}: aguardando assinatura do termo de desligamento`,
      });
      continue;
    }
    if (phase === 'awaiting_settlement') {
      alerts.push({
        severity: 'medium',
        type: 'awaiting_settlement',
        message: `${name}: acerto de desligamento pendente`,
      });
      continue;
    }
    const due = t.due_at ? new Date(String(t.due_at)).getTime() : null;
    if (due && due < now) {
      alerts.push({
        severity: 'high',
        type: 'settlement_overdue',
        message: `${name}: prazo de acerto financeiro estourado`,
      });
    }
  }
  return alerts.slice(0, 12);
}
