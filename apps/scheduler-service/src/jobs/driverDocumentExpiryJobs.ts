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

type JsonRecord = Record<string, unknown>;

type DriverRowForDocAlerts = DriverDocumentInput & {
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

const DOC_PREF_KEYS = {
  warning: 'driver_document_expiry_warning',
  expired: 'driver_document_expired',
} as const;

function prefToBoolean(key: string, raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const inApp = (raw as Record<string, unknown>).in_app;
    if (typeof inApp === 'boolean') return inApp;
  }
  return true;
}

async function userAllowsDocAlert(
  db: SupabaseClient,
  userId: string,
  alertKind: AlertKind
): Promise<boolean> {
  const { data } = await db.from('users').select('notification_preferences').eq('id', userId).maybeSingle();
  const prefs = (data?.notification_preferences || {}) as JsonRecord;
  const key = alertKind.endsWith('_expired') ? DOC_PREF_KEYS.expired : DOC_PREF_KEYS.warning;
  return prefToBoolean(key, prefs[key]);
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

async function cancelDriverDocTasks(
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

  const { resolveDocAlertTaskTypeFromRules } = await import('@plataforma/ops-task-catalog');
  const { isTaskTypeCreatableForWorkspace, loadOpsTaskAutomationRules } = await import('../lib/opsTaskCatalog');
  const rules = await loadOpsTaskAutomationRules(db, workspaceId);
  const taskType = resolveDocAlertTaskTypeFromRules(
    rules,
    alertKind.endsWith('_expired') ? 'expired' : 'expiring'
  );
  const allowed = await isTaskTypeCreatableForWorkspace(db, workspaceId, taskType, 'scheduler_doc');
  if (!allowed) return;

  const docKind = documentKindFromAlertKind(alertKind);
  const expiresAt = expiresAtForKind(driver, docKind);
  const title = buildDocumentAlertTitle(driver.name, alertKind, expiresAt);
  const description = buildDocumentAlertDescription(alertKind, expiresAt);

  await db.from('pending_tasks').insert({
    workspace_id: workspaceId,
    task_type: taskType,
    title,
    description,
    status: 'open',
    priority: priorityForAlertKind(alertKind),
    driver_id: driver.id,
    assignee_id: assigneeId,
    source: 'system',
    metadata: {
      alert_kind: alertKind,
      document_type: docKind,
      leader_id: leaderId,
      pharmacy_id: pharmacyId,
      recipient_role: recipientRole,
      expires_at: expiresAt,
    },
  });
}

async function processDriverDocumentAlertsForRow(db: SupabaseClient, driver: DriverRowForDocAlerts) {
  if (driver.status !== 'active') {
    await cancelDriverDocTasks(db, driver.workspace_id, driver.id);
    return { doc_status: driver.doc_status, alerts_created: 0 };
  }

  const evaluated = evaluateDriverDocuments(driver);
  if (driver.doc_status !== evaluated.doc_status) {
    await db.from('drivers').update({ doc_status: evaluated.doc_status, updated_at: new Date().toISOString() }).eq('id', driver.id);
  }

  const pharmacyRow = await resolvePharmacy(db, driver.primary_pharmacy_id);
  const attendantId = pharmacyRow?.primary_attendant_id || null;
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

export function registerDriverDocumentExpiryJobs(db: SupabaseClient, timezone: string) {
  return {
    timezone,
    runDriverDocumentExpiryJob: () => runDriverDocumentExpiryJob(db),
  };
}

async function runDriverDocumentExpiryJob(db: SupabaseClient) {
  const { data: drivers, error } = await db
    .from('drivers')
    .select(
      'id, workspace_id, name, status, doc_status, cnh_expires_at, has_digital_certificate, digital_certificate_expires_at, primary_pharmacy_id, override_leader_id'
    )
    .eq('status', 'active');

  if (error) throw error;
  if (!drivers?.length) return { processed: 0 };

  let processed = 0;
  for (const row of drivers) {
    await processDriverDocumentAlertsForRow(db, row as DriverRowForDocAlerts);
    processed += 1;
  }
  return { processed };
}
