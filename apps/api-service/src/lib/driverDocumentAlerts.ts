import type { SupabaseClient } from '@supabase/supabase-js';
import {
  alertKindsForDriver,
  buildDocumentAlertDescription,
  buildDocumentAlertTitle,
  documentKindFromAlertKind,
  DRIVER_DOC_TASK_TYPES,
  evaluateDriverDocuments,
  priorityForAlertKind,
  type AlertKind,
  type DocumentKind,
  type DriverDocumentInput,
} from '@plataforma/operational-notes';
import { isInAppEnabled } from './notificationPreferences';
import { insertPendingTask, TASK_SECTOR_NAMES } from './pendingTaskFactory';
import { resolveLeastOpenAssigneeInSector } from './taskAssignment';

type JsonRecord = Record<string, unknown>;

export type DriverRowForDocAlerts = DriverDocumentInput & {
  id: string;
  workspace_id: string;
  name: string;
  status: string;
  primary_pharmacy_id?: string | null;
  override_leader_id?: string | null;
  doc_status?: string | null;
};

type PharmacyRow = {
  primary_attendant_id?: string | null;
  leader_id?: string | null;
};

type LeaderRow = {
  id: string;
  user_id?: string | null;
};

async function userAllowsDocAlert(
  db: SupabaseClient,
  userId: string,
  alertKind: AlertKind
): Promise<boolean> {
  const { data } = await db.from('users').select('notification_preferences').eq('id', userId).maybeSingle();
  const prefs = (data?.notification_preferences || {}) as JsonRecord;
  const key = alertKind.endsWith('_expired') ? 'driver_document_expired' : 'driver_document_expiry_warning';
  return isInAppEnabled(prefs, key as 'driver_document_expired' | 'driver_document_expiry_warning');
}

function expiresAtForKind(driver: DriverRowForDocAlerts, kind: DocumentKind): string | null {
  return kind === 'cnh' ? driver.cnh_expires_at || null : driver.digital_certificate_expires_at || null;
}

async function resolvePharmacy(db: SupabaseClient, pharmacyId: string | null | undefined): Promise<PharmacyRow | null> {
  if (!pharmacyId) return null;
  const { data } = await db
    .from('pharmacies')
    .select('primary_attendant_id, leader_id')
    .eq('id', pharmacyId)
    .maybeSingle();
  return (data as PharmacyRow | null) || null;
}

async function resolveLeader(db: SupabaseClient, leaderId: string | null | undefined): Promise<LeaderRow | null> {
  if (!leaderId) return null;
  const { data } = await db.from('leaders').select('id, user_id').eq('id', leaderId).maybeSingle();
  return (data as LeaderRow | null) || null;
}

async function hasOpenDocTask(
  db: SupabaseClient,
  workspaceId: string,
  driverId: string,
  assigneeId: string | null,
  leaderId: string | null,
  alertKind: AlertKind
): Promise<boolean> {
  let q = db
    .from('pending_tasks')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('driver_id', driverId)
    .in('task_type', [...DRIVER_DOC_TASK_TYPES])
    .in('status', ['open', 'in_progress'])
    .eq('metadata->>alert_kind', alertKind);

  if (assigneeId) q = q.eq('assignee_id', assigneeId);
  else if (leaderId) q = q.eq('metadata->>leader_id', leaderId);

  const { data } = await q.limit(1).maybeSingle();
  return Boolean(data?.id);
}

export async function cancelDriverDocTasks(
  db: SupabaseClient,
  workspaceId: string,
  driverId: string,
  documentKind?: DocumentKind
) {
  const { data: rows } = await db
    .from('pending_tasks')
    .select('id, metadata')
    .eq('workspace_id', workspaceId)
    .eq('driver_id', driverId)
    .in('task_type', [...DRIVER_DOC_TASK_TYPES])
    .in('status', ['open', 'in_progress']);

  const ids = (rows || [])
    .filter((r) => {
      if (!documentKind) return true;
      const kind = String((r.metadata as JsonRecord)?.document_type || '');
      return kind === documentKind;
    })
    .map((r) => String(r.id));

  if (!ids.length) return;
  await db
    .from('pending_tasks')
    .update({ status: 'cancelled', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .in('id', ids);
}

async function createDocTaskIfNeeded(
  db: SupabaseClient,
  args: {
    workspaceId: string;
    driver: DriverRowForDocAlerts;
    alertKind: AlertKind;
    assigneeId: string | null;
    leaderId: string | null;
    pharmacyId: string | null;
    recipientRole: 'attendant' | 'leader';
  }
) {
  const { workspaceId, driver, alertKind, assigneeId, leaderId, pharmacyId, recipientRole } = args;
  if (assigneeId) {
    const allowed = await userAllowsDocAlert(db, assigneeId, alertKind);
    if (!allowed) return;
  }

  const exists = await hasOpenDocTask(db, workspaceId, driver.id, assigneeId, leaderId, alertKind);
  if (exists) return;

  const { resolveDocAlertTaskType } = await import('./opsTaskAutomation');
  const { isTaskTypeCreatableForWorkspace } = await import('./opsTaskCatalog');
  const taskType = await resolveDocAlertTaskType(
    db,
    workspaceId,
    alertKind.endsWith('_expired') ? 'expired' : 'expiring'
  );
  const allowed = await isTaskTypeCreatableForWorkspace(db, workspaceId, taskType, 'scheduler_doc');
  if (!allowed) return;

  const docKind = documentKindFromAlertKind(alertKind);
  const expiresAt = expiresAtForKind(driver, docKind);
  const title = buildDocumentAlertTitle(driver.name, alertKind, expiresAt);
  const description = buildDocumentAlertDescription(alertKind, expiresAt);

  const sectorName =
    recipientRole === 'leader' ? undefined : TASK_SECTOR_NAMES.ATENDIMENTO_GERAL;
  const strategy = recipientRole === 'leader' ? 'fixed' : 'least_open';

  await insertPendingTask(
    db,
    {
      workspace_id: workspaceId,
      task_type: taskType,
      title,
      description,
      status: 'open',
      priority: priorityForAlertKind(alertKind),
      driver_id: driver.id,
      assignee_id: assigneeId,
      sector_name: sectorName,
      assign_strategy: strategy,
      source: 'system',
      metadata: {
        alert_kind: alertKind,
        document_type: docKind,
        leader_id: leaderId,
        pharmacy_id: pharmacyId,
        recipient_role: recipientRole,
        expires_at: expiresAt,
      },
    },
    { kind: 'none' }
  );
}

export async function processDriverDocumentAlertsForRow(
  db: SupabaseClient,
  driver: DriverRowForDocAlerts,
  pharmacy?: PharmacyRow | null
) {
  if (driver.status !== 'active') {
    await cancelDriverDocTasks(db, driver.workspace_id, driver.id);
    return { doc_status: driver.doc_status, alerts_created: 0 };
  }

  const evaluated = evaluateDriverDocuments(driver);
  if (driver.doc_status !== evaluated.doc_status) {
    await db.from('drivers').update({ doc_status: evaluated.doc_status, updated_at: new Date().toISOString() }).eq('id', driver.id);
  }

  const pharmacyRow = pharmacy ?? (await resolvePharmacy(db, driver.primary_pharmacy_id));
  const agAssignee = await resolveLeastOpenAssigneeInSector(
    db,
    driver.workspace_id,
    TASK_SECTOR_NAMES.ATENDIMENTO_GERAL
  );
  const attendantId = agAssignee.assigneeId;
  const leaderId = driver.override_leader_id || pharmacyRow?.leader_id || null;
  const leader = await resolveLeader(db, leaderId);
  const leaderUserId = leader?.user_id || null;

  const alertKinds = alertKindsForDriver(driver);
  let created = 0;
  for (const alertKind of alertKinds) {
    if (attendantId) {
      await createDocTaskIfNeeded(db, {
        workspaceId: driver.workspace_id,
        driver,
        alertKind,
        assigneeId: attendantId,
        leaderId,
        pharmacyId: driver.primary_pharmacy_id || null,
        recipientRole: 'attendant',
      });
      created += 1;
    }
    if (leaderId) {
      await createDocTaskIfNeeded(db, {
        workspaceId: driver.workspace_id,
        driver,
        alertKind,
        assigneeId: leaderUserId,
        leaderId,
        pharmacyId: driver.primary_pharmacy_id || null,
        recipientRole: 'leader',
      });
      created += 1;
    }
  }

  return { doc_status: evaluated.doc_status, alerts_created: created };
}

/** Após PUT: recalcular doc_status e cancelar tarefas de docs que voltaram a válidos. */
export async function syncDriverDocumentsAfterSave(db: SupabaseClient, driverId: string, workspaceId: string) {
  const { data: driver, error } = await db
    .from('drivers')
    .select(
      'id, workspace_id, name, status, doc_status, cnh_expires_at, has_digital_certificate, digital_certificate_expires_at, primary_pharmacy_id, override_leader_id'
    )
    .eq('id', driverId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (error || !driver) return;

  const row = driver as DriverRowForDocAlerts;
  const evaluated = evaluateDriverDocuments(row);

  if (row.cnh_expires_at && !['warning_30', 'warning_7', 'expired'].includes(evaluated.cnh)) {
    await cancelDriverDocTasks(db, workspaceId, driverId, 'cnh');
  }
  if (
    row.has_digital_certificate &&
    row.digital_certificate_expires_at &&
    !['warning_30', 'warning_7', 'expired'].includes(evaluated.certificate)
  ) {
    await cancelDriverDocTasks(db, workspaceId, driverId, 'certificate');
  }

  if (row.status !== 'active') {
    await cancelDriverDocTasks(db, workspaceId, driverId);
  }

  await db
    .from('drivers')
    .update({ doc_status: evaluated.doc_status, updated_at: new Date().toISOString() })
    .eq('id', driverId);

  if (row.status === 'active') {
    await processDriverDocumentAlertsForRow(db, { ...row, doc_status: evaluated.doc_status });
  }
}

export function buildDocumentStatusPayload(driver: DriverDocumentInput) {
  const evaluated = evaluateDriverDocuments(driver);
  return {
    doc_status: evaluated.doc_status,
    cnh: { state: evaluated.cnh, expires_at: driver.cnh_expires_at || null },
    certificate: {
      state: evaluated.certificate,
      expires_at: driver.digital_certificate_expires_at || null,
      has_certificate: Boolean(driver.has_digital_certificate),
    },
    worst_state: evaluated.worst_state,
  };
}
