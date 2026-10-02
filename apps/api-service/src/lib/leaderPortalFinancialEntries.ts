import type { SupabaseClient } from '@supabase/supabase-js';
import { FinancialEntryStatus } from '@plataforma/operational-notes';
import { writeAuditLog } from './auditLog';

export const LEADER_ENTRIES_PAGE_SIZE = 20;
const CANCEL_REASON_MIN_LEN = 10;

const OPEN_ENTRY_STATUSES = [
  FinancialEntryStatus.PENDING_APPROVAL,
  FinancialEntryStatus.ACTIVE,
  FinancialEntryStatus.APPROVED,
  FinancialEntryStatus.INFORMED,
] as const;

export type LeaderFinancialEntryRow = {
  id: string;
  type: string;
  status: string;
  occurrence_kind: string | null;
  event_date: string | null;
  total_amount: number;
  created_at: string;
  notes?: string | null;
  description?: string | null;
  rejection_reason: string | null;
  coverage_of_entry_id: string | null;
  start_date?: string | null;
  shift?: string | null;
  drivers: { id: string; name: string; cpf?: string | null } | { id: string; name: string; cpf?: string | null }[] | null;
  pharmacies: { id: string; trade_name: string } | { id: string; trade_name: string }[] | null;
  financial_installments: Array<{
    id: string;
    installment_number?: number;
    due_date: string;
    amount: number;
    status: string;
    paid_at: string | null;
  }>;
  coverage_of_entry?: unknown;
};

export type LeaderEntryStatus =
  | 'pending_approval'
  | 'approved_pending_payment'
  | 'overdue'
  | 'paid'
  | 'rejected'
  | 'cancelled'
  | 'informed';

export type LeaderFinancialEntryView = {
  id: string;
  type: string;
  occurrence_kind: string | null;
  event_date: string | null;
  amount: number;
  created_at: string;
  payment_date: string | null;
  leader_status: LeaderEntryStatus;
  leader_status_label: string;
  cancel_reason: string | null;
  rejection_reason: string | null;
  coverage_of_entry_id: string | null;
  linked_entry_id: string | null;
  driver: { id: string; name: string } | null;
  pharmacy: { id: string; trade_name: string } | null;
  can_cancel: boolean;
};

export type LeaderAuditTimelineItem = {
  at: string;
  label: string;
  detail?: string | null;
};

export type LeaderFinancialEntryDetail = LeaderFinancialEntryView & {
  notes: string | null;
  description: string | null;
  shift: string | null;
  installments: Array<{
    id: string;
    installment_number: number;
    due_date: string;
    amount: number;
    status: string;
    paid_at: string | null;
  }>;
  coverage_of_entry: {
    id: string;
    type: string;
    occurrence_kind: string | null;
    event_date: string | null;
    status: string;
    notes: string | null;
    driver: { id: string; name: string } | null;
  } | null;
  linked_daily_entries: Array<{
    id: string;
    status: string;
    amount: number;
    driver: { id: string; name: string } | null;
  }>;
  audit_timeline: LeaderAuditTimelineItem[];
};

export type LeaderFinancialListQuery = {
  workspaceId: string;
  pharmacyIds: string[];
  page?: number;
  limit?: number;
  status_group?: 'open' | 'all' | 'done' | 'cancelled';
  occurrence_type?: 'all' | 'contracted_daily' | 'coverage_daily' | 'unexcused' | 'day_off';
  date_field?: 'event' | 'created';
  date_from?: string;
  date_to?: string;
  pharmacy_id?: string;
  driver_id?: string;
};

export type LeaderFinancialListResult = {
  entries: LeaderFinancialEntryView[];
  total: number;
  page: number;
  limit: number;
};

export type LeaderPortalStats = {
  pharmacies_count: number;
  drivers_count: number;
  pending_absences: number;
  pending_dailies: number;
  open_entries: number;
};

const STATUS_LABELS: Record<LeaderEntryStatus, string> = {
  pending_approval: 'Aguardando financeiro',
  approved_pending_payment: 'Aprovado — pagamento pendente',
  overdue: 'Atrasado — aguardando baixa',
  paid: 'Pago',
  rejected: 'Rejeitado pelo financeiro',
  cancelled: 'Cancelado',
  informed: 'Informativo (folga)',
};

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function extractShiftFromNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const match = String(notes).match(/Turno:\s*(\w+)/i);
  return match?.[1] ? match[1] : null;
}

export function deriveLeaderEntryStatus(
  entry: Pick<LeaderFinancialEntryRow, 'type' | 'status'>,
  installments: LeaderFinancialEntryRow['financial_installments'],
): LeaderEntryStatus {
  const status = String(entry.status || '').toLowerCase();
  if (status === FinancialEntryStatus.CANCELLED) return 'cancelled';
  if (status === FinancialEntryStatus.REJECTED) return 'rejected';
  if (status === FinancialEntryStatus.PENDING_APPROVAL) return 'pending_approval';
  if (status === FinancialEntryStatus.INFORMED) return 'informed';
  if (status === FinancialEntryStatus.SETTLED) return 'paid';

  const inst = installments[0];
  if (inst?.status === 'paid') return 'paid';
  if (inst?.status === 'overdue') return 'overdue';
  if (status === FinancialEntryStatus.ACTIVE || status === FinancialEntryStatus.APPROVED) {
    return 'approved_pending_payment';
  }
  return 'pending_approval';
}

function normalizeOne<T>(raw: T | T[] | null | undefined): T | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

function matchesStatusGroup(
  row: LeaderFinancialEntryRow,
  group: LeaderFinancialListQuery['status_group'],
): boolean {
  if (!group || group === 'all') return true;
  const leaderStatus = deriveLeaderEntryStatus(row, row.financial_installments || []);
  if (group === 'open') {
    return ['pending_approval', 'approved_pending_payment', 'overdue', 'informed'].includes(leaderStatus);
  }
  if (group === 'done') return leaderStatus === 'paid';
  return ['cancelled', 'rejected'].includes(leaderStatus);
}

function matchesOccurrenceType(
  row: LeaderFinancialEntryRow,
  occurrenceType: LeaderFinancialListQuery['occurrence_type'],
): boolean {
  if (!occurrenceType || occurrenceType === 'all') return true;
  if (occurrenceType === 'contracted_daily') {
    return row.type === 'daily' && row.occurrence_kind === 'contracted_daily';
  }
  if (occurrenceType === 'coverage_daily') {
    return row.type === 'daily' && Boolean(row.coverage_of_entry_id);
  }
  if (occurrenceType === 'unexcused') {
    return row.type === 'absence' && row.occurrence_kind === 'unexcused';
  }
  if (occurrenceType === 'day_off') {
    return row.type === 'absence' && row.occurrence_kind === 'day_off';
  }
  return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyLeaderListFilters(query: any, input: LeaderFinancialListQuery): any {
  let q = query
    .eq('workspace_id', input.workspaceId)
    .in('pharmacy_id', input.pharmacyIds)
    .not('occurrence_kind', 'is', null);

  if (input.pharmacy_id && input.pharmacyIds.includes(input.pharmacy_id)) {
    q = q.eq('pharmacy_id', input.pharmacy_id);
  }
  if (input.driver_id) {
    q = q.eq('driver_id', input.driver_id);
  }

  const dateField = input.date_field === 'created' ? 'created_at' : 'event_date';
  if (input.date_from) {
    if (dateField === 'created_at') {
      q = q.gte('created_at', `${input.date_from}T00:00:00.000Z`);
    } else {
      q = q.gte('event_date', input.date_from);
    }
  }
  if (input.date_to) {
    if (dateField === 'created_at') {
      q = q.lte('created_at', `${input.date_to}T23:59:59.999Z`);
    } else {
      q = q.lte('event_date', input.date_to);
    }
  }

  if (input.status_group === 'done') {
    q = q.in('status', [
      FinancialEntryStatus.SETTLED,
      FinancialEntryStatus.ACTIVE,
      FinancialEntryStatus.APPROVED,
    ]);
  } else if (input.status_group === 'cancelled') {
    q = q.in('status', [FinancialEntryStatus.CANCELLED, FinancialEntryStatus.REJECTED]);
  } else if (input.status_group === 'open') {
    q = q.in('status', [...OPEN_ENTRY_STATUSES]);
  }

  if (input.occurrence_type === 'contracted_daily') {
    q = q.eq('type', 'daily').eq('occurrence_kind', 'contracted_daily');
  } else if (input.occurrence_type === 'coverage_daily') {
    q = q.eq('type', 'daily').not('coverage_of_entry_id', 'is', null);
  } else if (input.occurrence_type === 'unexcused') {
    q = q.eq('type', 'absence').eq('occurrence_kind', 'unexcused');
  } else if (input.occurrence_type === 'day_off') {
    q = q.eq('type', 'absence').eq('occurrence_kind', 'day_off');
  }

  return q;
}

const LIST_SELECT = `
  id, type, status, occurrence_kind, event_date, total_amount, created_at,
  rejection_reason, coverage_of_entry_id, start_date,
  drivers(id, name),
  pharmacies(id, trade_name),
  financial_installments(id, due_date, amount, status, paid_at)
`;

function mapEntryToView(row: LeaderFinancialEntryRow): LeaderFinancialEntryView {
  const installments = row.financial_installments || [];
  const leaderStatus = deriveLeaderEntryStatus(row, installments);
  const paymentDate = dateOnly(installments[0]?.due_date) || dateOnly(row.start_date) || null;
  const driver = normalizeOne(row.drivers);
  const pharmacy = normalizeOne(row.pharmacies);

  return {
    id: String(row.id),
    type: String(row.type),
    occurrence_kind: row.occurrence_kind ? String(row.occurrence_kind) : null,
    event_date: dateOnly(row.event_date),
    amount: Number(row.total_amount || 0),
    created_at: String(row.created_at),
    payment_date: paymentDate,
    leader_status: leaderStatus,
    leader_status_label: STATUS_LABELS[leaderStatus],
    cancel_reason: leaderStatus === 'cancelled' ? row.rejection_reason : null,
    rejection_reason: leaderStatus === 'rejected' ? row.rejection_reason : null,
    coverage_of_entry_id: row.coverage_of_entry_id ? String(row.coverage_of_entry_id) : null,
    linked_entry_id: row.coverage_of_entry_id ? String(row.coverage_of_entry_id) : null,
    driver: driver ? { id: String(driver.id), name: String(driver.name) } : null,
    pharmacy: pharmacy ? { id: String(pharmacy.id), trade_name: String(pharmacy.trade_name) } : null,
    can_cancel: String(row.status) === FinancialEntryStatus.PENDING_APPROVAL,
  };
}

const LIST_FETCH_CAP = 1000;

export async function listLeaderPortalFinancialEntries(
  db: SupabaseClient,
  input: LeaderFinancialListQuery,
): Promise<LeaderFinancialListResult> {
  if (!input.pharmacyIds.length) {
    return { entries: [], total: 0, page: 1, limit: LEADER_ENTRIES_PAGE_SIZE };
  }

  const page = Math.max(1, input.page ?? 1);
  const limit = Math.min(Math.max(input.limit ?? LEADER_ENTRIES_PAGE_SIZE, 1), 100);
  const from = (page - 1) * limit;

  let query = applyLeaderListFilters(db.from('financial_entries').select(LIST_SELECT), input);
  query = query.order('created_at', { ascending: false }).limit(LIST_FETCH_CAP);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  let rows = (data || []) as unknown as LeaderFinancialEntryRow[];
  if (input.status_group && input.status_group !== 'all') {
    rows = rows.filter((row) => matchesStatusGroup(row, input.status_group));
  }
  if (input.occurrence_type && input.occurrence_type !== 'all') {
    rows = rows.filter((row) => matchesOccurrenceType(row, input.occurrence_type));
  }

  const total = rows.length;
  const pageRows = rows.slice(from, from + limit);

  return {
    entries: pageRows.map(mapEntryToView),
    total,
    page,
    limit,
  };
}

export async function getLeaderPortalFinancialEntryDetail(
  db: SupabaseClient,
  input: { workspaceId: string; pharmacyIds: string[]; entryId: string; actorUserId?: string | null },
): Promise<LeaderFinancialEntryDetail | null> {
  const detailSelect = `
    id, type, status, occurrence_kind, event_date, total_amount, created_at, notes, description,
    rejection_reason, coverage_of_entry_id, start_date, driver_id, pharmacy_id,
    drivers(id, name, cpf),
    pharmacies(id, trade_name),
    financial_installments(id, installment_number, due_date, amount, status, paid_at),
    coverage_of_entry:financial_entries!coverage_of_entry_id(
      id, type, occurrence_kind, event_date, status, notes,
      drivers(id, name)
    )
  `;

  const { data, error } = await db
    .from('financial_entries')
    .select(detailSelect)
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.entryId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const pharmacyId = String((data as { pharmacy_id?: string }).pharmacy_id || '');
  if (!input.pharmacyIds.includes(pharmacyId)) return null;

  const row = data as unknown as LeaderFinancialEntryRow;
  const base = mapEntryToView(row);
  const coverageRef = normalizeOne(row.coverage_of_entry as LeaderFinancialEntryRow['coverage_of_entry']);

  const { data: linkedDailies } = await db
    .from('financial_entries')
    .select('id, status, total_amount, drivers(id, name)')
    .eq('workspace_id', input.workspaceId)
    .eq('coverage_of_entry_id', input.entryId);

  const auditTimeline = await buildAuditTimeline(db, input.workspaceId, input.entryId, row, input.actorUserId);

  return {
    ...base,
    notes: row.notes ? String(row.notes) : null,
    description: row.description ? String(row.description) : null,
    shift: extractShiftFromNotes(row.notes),
    installments: (row.financial_installments || []).map((inst) => ({
      id: String(inst.id),
      installment_number: Number(inst.installment_number || 1),
      due_date: dateOnly(inst.due_date) || String(inst.due_date),
      amount: Number(inst.amount || 0),
      status: String(inst.status),
      paid_at: inst.paid_at ? String(inst.paid_at) : null,
    })),
    coverage_of_entry: coverageRef
      ? {
          id: String((coverageRef as { id: string }).id),
          type: String((coverageRef as { type: string }).type),
          occurrence_kind: (coverageRef as { occurrence_kind?: string }).occurrence_kind
            ? String((coverageRef as { occurrence_kind?: string }).occurrence_kind)
            : null,
          event_date: dateOnly((coverageRef as { event_date?: string }).event_date),
          status: String((coverageRef as { status: string }).status),
          notes: (coverageRef as { notes?: string }).notes
            ? String((coverageRef as { notes?: string }).notes)
            : null,
          driver: normalizeOne((coverageRef as { drivers?: unknown }).drivers as LeaderFinancialEntryRow['drivers'])
            ? {
                id: String(normalizeOne((coverageRef as { drivers?: unknown }).drivers as LeaderFinancialEntryRow['drivers'])!.id),
                name: String(normalizeOne((coverageRef as { drivers?: unknown }).drivers as LeaderFinancialEntryRow['drivers'])!.name),
              }
            : null,
        }
      : null,
    linked_daily_entries: (linkedDailies || []).map((daily) => ({
      id: String(daily.id),
      status: String(daily.status),
      amount: Number(daily.total_amount || 0),
      driver: normalizeOne(daily.drivers as LeaderFinancialEntryRow['drivers'])
        ? {
            id: String(normalizeOne(daily.drivers as LeaderFinancialEntryRow['drivers'])!.id),
            name: String(normalizeOne(daily.drivers as LeaderFinancialEntryRow['drivers'])!.name),
          }
        : null,
    })),
    audit_timeline: auditTimeline,
  };
}

async function buildAuditTimeline(
  db: SupabaseClient,
  workspaceId: string,
  entryId: string,
  row: LeaderFinancialEntryRow,
  actorUserId?: string | null,
): Promise<LeaderAuditTimelineItem[]> {
  const items: LeaderAuditTimelineItem[] = [];

  items.push({
    at: String(row.created_at),
    label: 'Enviado pelo líder',
    detail: null,
  });

  type AuditLogRow = {
    action?: string;
    created_at?: string;
    new_data?: unknown;
    user_id?: string | null;
    actor_id?: string | null;
    metadata?: Record<string, unknown> | null;
  };

  const auditSelect =
    'action, created_at, new_data, user_id, actor_id, metadata';
  let logs: AuditLogRow[] | null = null;
  const primary = await db
    .from('audit_logs')
    .select(auditSelect)
    .eq('workspace_id', workspaceId)
    .eq('entity_type', 'financial_entry')
    .eq('entity_id', entryId)
    .order('created_at', { ascending: true });

  if (primary.error) {
    const fallback = await db
      .from('audit_logs')
      .select('action, created_at, new_data, user_id')
      .eq('workspace_id', workspaceId)
      .eq('entity_type', 'financial_entry')
      .eq('entity_id', entryId)
      .order('created_at', { ascending: true });
    logs = (fallback.data || []) as AuditLogRow[];
  } else {
    logs = (primary.data || []) as AuditLogRow[];
  }

  for (const log of logs) {
    const action = String(log.action || '');
    const meta = (log.metadata || {}) as Record<string, unknown>;
    const newData = (log.new_data || {}) as Record<string, unknown>;
    const actorId = String(log.actor_id || log.user_id || '');
    if (action === 'financial_entries.cancelled_by_leader') {
      const reason = String(meta.cancel_reason || row.rejection_reason || '').trim();
      const byYou = actorUserId && actorId === actorUserId;
      items.push({
        at: String(log.created_at),
        label: byYou ? 'Cancelado por você' : 'Cancelado pelo líder',
        detail: reason || null,
      });
    } else if (action === 'approved') {
      items.push({ at: String(log.created_at), label: 'Aprovado pelo financeiro', detail: null });
    } else if (action === 'rejected') {
      items.push({
        at: String(log.created_at),
        label: 'Rejeitado pelo financeiro',
        detail: String(newData.rejection_reason || meta.rejection_reason || row.rejection_reason || '') || null,
      });
    }
  }

  for (const inst of row.financial_installments || []) {
    if (inst.status === 'paid' && inst.paid_at) {
      items.push({
        at: String(inst.paid_at),
        label: row.type === 'daily' ? 'Pagamento registrado (baixa)' : 'Desconto registrado',
        detail: null,
      });
    }
  }

  if (String(row.status) === FinancialEntryStatus.CANCELLED && !items.some((i) => i.label.includes('Cancelado'))) {
    items.push({
      at: String(row.created_at),
      label: 'Cancelado',
      detail: row.rejection_reason,
    });
  }

  return items.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

export async function findDuplicateOpenOccurrences(
  db: SupabaseClient,
  input: {
    workspaceId: string;
    pharmacyIds: string[];
    driverId: string;
    eventDate: string;
    pharmacyId: string;
  },
): Promise<LeaderFinancialEntryView[]> {
  if (!input.pharmacyIds.includes(input.pharmacyId)) return [];

  const { data, error } = await db
    .from('financial_entries')
    .select(LIST_SELECT)
    .eq('workspace_id', input.workspaceId)
    .eq('pharmacy_id', input.pharmacyId)
    .eq('driver_id', input.driverId)
    .eq('event_date', input.eventDate)
    .not('occurrence_kind', 'is', null)
    .in('status', [...OPEN_ENTRY_STATUSES])
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) throw new Error(error.message);
  const rows = (data || []) as unknown as LeaderFinancialEntryRow[];
  return rows.map(mapEntryToView);
}

export async function computeLeaderPortalStats(
  db: SupabaseClient,
  input: { workspaceId: string; pharmacyIds: string[]; driversCount: number },
): Promise<LeaderPortalStats> {
  const { workspaceId, pharmacyIds, driversCount } = input;
  if (!pharmacyIds.length) {
    return {
      pharmacies_count: 0,
      drivers_count: 0,
      pending_absences: 0,
      pending_dailies: 0,
      open_entries: 0,
    };
  }

  const base = () =>
    db
      .from('financial_entries')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .in('pharmacy_id', pharmacyIds)
      .not('occurrence_kind', 'is', null);

  const [{ count: pendingAbsences }, { count: pendingDailies }, { count: openEntries }] = await Promise.all([
    base()
      .eq('type', 'absence')
      .eq('occurrence_kind', 'unexcused')
      .eq('status', FinancialEntryStatus.PENDING_APPROVAL),
    base().eq('type', 'daily').eq('status', FinancialEntryStatus.PENDING_APPROVAL),
    base().in('status', [...OPEN_ENTRY_STATUSES]),
  ]);

  return {
    pharmacies_count: pharmacyIds.length,
    drivers_count: driversCount,
    pending_absences: pendingAbsences || 0,
    pending_dailies: pendingDailies || 0,
    open_entries: openEntries || 0,
  };
}

async function cancelSingleEntry(
  db: SupabaseClient,
  input: {
    workspaceId: string;
    entryId: string;
    cancelReason: string;
    actorId: string;
    leaderId: string;
  },
): Promise<void> {
  const { data: entry, error: fetchErr } = await db
    .from('financial_entries')
    .select('id, status, type, coverage_of_entry_id, pharmacy_id')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.entryId)
    .maybeSingle();
  if (fetchErr) throw new Error(fetchErr.message);
  if (!entry) throw new Error('Lançamento não encontrado');
  if (String(entry.status) !== FinancialEntryStatus.PENDING_APPROVAL) {
    throw new Error('Só é possível cancelar lançamentos aguardando aprovação do financeiro.');
  }

  const now = new Date().toISOString();
  const { data: updated, error: updErr } = await db
    .from('financial_entries')
    .update({
      status: FinancialEntryStatus.CANCELLED,
      rejection_reason: input.cancelReason.trim(),
      updated_at: now,
    })
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.entryId)
    .eq('status', FinancialEntryStatus.PENDING_APPROVAL)
    .select('id')
    .single();
  if (updErr || !updated) throw new Error(updErr?.message || 'Falha ao cancelar lançamento');

  await db
    .from('financial_installments')
    .update({ status: 'cancelled' })
    .eq('workspace_id', input.workspaceId)
    .eq('entry_id', input.entryId)
    .in('status', ['pending', 'overdue']);

  await writeAuditLog({
    actor_id: input.actorId,
    action: 'financial_entries.cancelled_by_leader',
    entity_type: 'financial_entry',
    entity_id: input.entryId,
    workspace_id: input.workspaceId,
    metadata: {
      leader_id: input.leaderId,
      cancel_reason: input.cancelReason.trim(),
      entry_type: entry.type,
      coverage_of_entry_id: entry.coverage_of_entry_id || null,
    },
  });
}

export async function cancelLeaderPortalFinancialEntry(
  db: SupabaseClient,
  input: {
    workspaceId: string;
    pharmacyIds: string[];
    entryId: string;
    cancelReason: string;
    actorId: string;
    leaderId: string;
  },
): Promise<{ cancelled_ids: string[] }> {
  const reason = String(input.cancelReason || '').trim();
  if (reason.length < CANCEL_REASON_MIN_LEN) {
    throw new Error(`Informe o motivo do cancelamento (mínimo ${CANCEL_REASON_MIN_LEN} caracteres).`);
  }

  const { data: entry, error: fetchErr } = await db
    .from('financial_entries')
    .select('id, status, type, coverage_of_entry_id, pharmacy_id')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.entryId)
    .maybeSingle();
  if (fetchErr) throw new Error(fetchErr.message);
  if (!entry) throw new Error('Lançamento não encontrado');

  const pharmacyId = String(entry.pharmacy_id || '');
  if (!input.pharmacyIds.includes(pharmacyId)) {
    throw new Error('Lançamento fora da sua rede de farmácias.');
  }
  if (String(entry.status) !== FinancialEntryStatus.PENDING_APPROVAL) {
    throw new Error('Só é possível cancelar lançamentos aguardando aprovação do financeiro.');
  }

  const cancelledIds: string[] = [];

  if (String(entry.type) === 'daily' && entry.coverage_of_entry_id) {
    const absenceId = String(entry.coverage_of_entry_id);
    const { data: absence } = await db
      .from('financial_entries')
      .select('id, status')
      .eq('workspace_id', input.workspaceId)
      .eq('id', absenceId)
      .maybeSingle();

    await cancelSingleEntry(db, { ...input, entryId: input.entryId });
    cancelledIds.push(input.entryId);

    if (absence && String(absence.status) === FinancialEntryStatus.PENDING_APPROVAL) {
      await cancelSingleEntry(db, { ...input, entryId: absenceId });
      cancelledIds.push(absenceId);
    }
    return { cancelled_ids: cancelledIds };
  }

  if (String(entry.type) === 'absence') {
    const { data: linkedDailies } = await db
      .from('financial_entries')
      .select('id, status')
      .eq('workspace_id', input.workspaceId)
      .eq('coverage_of_entry_id', input.entryId)
      .eq('status', FinancialEntryStatus.PENDING_APPROVAL);

    for (const daily of linkedDailies || []) {
      await cancelSingleEntry(db, { ...input, entryId: String(daily.id) });
      cancelledIds.push(String(daily.id));
    }
  }

  await cancelSingleEntry(db, input);
  cancelledIds.push(input.entryId);
  return { cancelled_ids: Array.from(new Set(cancelledIds)) };
}

export { STATUS_LABELS as LEADER_FINANCIAL_STATUS_LABELS };
