import type { SupabaseClient } from '@supabase/supabase-js';
import {
  listAllAutentiqueDocuments,
  signatureStatusFromDocument,
  canCallAutentiqueApi,
  type AutentiqueDocument,
} from './autentiqueClient';
import {
  parseAutentiqueDocumentName,
  SIGNATURE_TRACKED_TASK_TYPES,
  type SignatureTrackedTaskType,
} from './autentiqueSignature';

export function normalizeSignatureEmail(email: string | null | undefined): string {
  return String(email || '').trim().toLowerCase();
}

export async function resolveDriverByEmailForSignature(
  db: SupabaseClient,
  workspaceId: string,
  email: string
): Promise<{ id: string; name: string } | null> {
  const { data } = await db
    .from('drivers')
    .select('id, name')
    .eq('workspace_id', workspaceId)
    .ilike('email', email)
    .limit(2);
  if (!data || data.length !== 1) return null;
  return { id: String(data[0].id), name: String(data[0].name || '') };
}

export function taskTypeForAutentiqueDocTipo(tipo: string): SignatureTrackedTaskType | null {
  if (tipo === 'MATRICULA') return 'driver_enrollment_prep';
  if (tipo === 'DESLIGAMENTO') return 'driver_termination_prep';
  return null;
}

export async function findOpenSignatureTaskForSync(
  db: SupabaseClient,
  workspaceId: string,
  driverId: string,
  preferredType?: SignatureTrackedTaskType | null,
  expectedName?: string | null
) {
  let q = db
    .from('pending_tasks')
    .select('id, task_type, title, assignee_id, driver_id, metadata, status')
    .eq('workspace_id', workspaceId)
    .eq('driver_id', driverId)
    .in('task_type', [...SIGNATURE_TRACKED_TASK_TYPES])
    .order('created_at', { ascending: false });

  if (preferredType) q = q.eq('task_type', preferredType);

  const { data, error } = await q.limit(5);
  if (error) throw new Error(error.message);

  const rows = (data || []).filter((row) => {
    const status = String(row.status || '').trim().toLowerCase();
    return status !== 'cancelled' && status !== 'canceled' && status !== 'archived';
  });
  if (expectedName) {
    const match = rows.find((r) => {
      const meta = (r.metadata || {}) as Record<string, unknown>;
      return meta.autentique_document_name_expected === expectedName;
    });
    if (match) return match;
  }
  return rows[0] || null;
}

export type SignatureTaskMetadataUpdate = {
  autentique_document_id?: string;
  autentique_document_name?: string;
  signature_status: string;
  signature_match_method: string;
  coop_signature_status?: string | null;
  driver_email?: string | null;
};

export type SignatureTransitionContext = {
  workspaceId: string;
  taskId: string;
  driverId: string;
  driverName: string;
  assigneeId: string | null;
  prevStatus: string | null;
  nextStatus: string;
};

export function buildSignatureTaskMetadata(
  taskRow: Record<string, unknown>,
  update: SignatureTaskMetadataUpdate
): { prevStatus: string | null; nextMeta: Record<string, unknown> } {
  const meta = ((taskRow.metadata || {}) as Record<string, unknown>) || {};
  const prevStatus = meta.signature_status != null ? String(meta.signature_status) : null;
  const nextMeta = {
    ...meta,
    autentique_document_id: update.autentique_document_id ?? meta.autentique_document_id,
    autentique_document_name: update.autentique_document_name ?? meta.autentique_document_name,
    signature_status: update.signature_status,
    signature_updated_at: new Date().toISOString(),
    signature_match_method: update.signature_match_method,
    coop_signature_status: update.coop_signature_status ?? meta.coop_signature_status,
    signature_driver_email: update.driver_email ?? meta.signature_driver_email,
  };
  return { prevStatus, nextMeta };
}

export function signatureTransitionContextFromTask(
  taskRow: Record<string, unknown>,
  workspaceId: string,
  prevStatus: string | null,
  nextStatus: string
): SignatureTransitionContext {
  const meta = (taskRow.metadata || {}) as Record<string, unknown>;
  const driverName = String(meta.driver_name || taskRow.title || 'Entregador').replace(/^[^:]+:\s*/, '');
  return {
    workspaceId,
    taskId: String(taskRow.id),
    driverId: taskRow.driver_id ? String(taskRow.driver_id) : '',
    driverName,
    assigneeId: taskRow.assignee_id ? String(taskRow.assignee_id) : null,
    prevStatus,
    nextStatus,
  };
}

export async function persistSignatureTaskMetadata(
  db: SupabaseClient,
  taskId: string,
  nextMeta: Record<string, unknown>
) {
  const { error } = await db
    .from('pending_tasks')
    .update({ metadata: nextMeta, updated_at: new Date().toISOString() })
    .eq('id', taskId);
  if (error) throw new Error(error.message);
}

export async function applySignatureUpdateToTask(
  db: SupabaseClient,
  taskRow: Record<string, unknown>,
  workspaceId: string,
  update: SignatureTaskMetadataUpdate,
  onTransition: (ctx: SignatureTransitionContext) => Promise<void>
) {
  const { prevStatus, nextMeta } = buildSignatureTaskMetadata(taskRow, update);
  await persistSignatureTaskMetadata(db, String(taskRow.id), nextMeta);
  await onTransition(
    signatureTransitionContextFromTask(taskRow, workspaceId, prevStatus, update.signature_status)
  );
}

export async function syncAutentiqueDocumentToTasks(
  db: SupabaseClient,
  workspaceId: string,
  doc: AutentiqueDocument,
  onTransition: (ctx: SignatureTransitionContext) => Promise<void>
): Promise<boolean> {
  const parsed = parseAutentiqueDocumentName(doc.name);
  const { driverStatus, coopStatus, driverEmail } = signatureStatusFromDocument(doc);

  let driverId: string | null = parsed?.driverId || null;
  let matchMethod = 'aethera_driver_id';
  const taskType = parsed ? taskTypeForAutentiqueDocTipo(parsed.tipo) : null;

  if (!driverId && driverEmail) {
    const byEmail = await resolveDriverByEmailForSignature(
      db,
      workspaceId,
      normalizeSignatureEmail(driverEmail)
    );
    if (byEmail) {
      driverId = byEmail.id;
      matchMethod = 'signer_email';
    }
  }

  if (!driverId) return false;

  const task = await findOpenSignatureTaskForSync(
    db,
    workspaceId,
    driverId,
    taskType,
    doc.name.startsWith('AETHERA_') ? doc.name : null
  );
  if (!task) return false;

  await applySignatureUpdateToTask(
    db,
    { ...task, workspace_id: workspaceId },
    workspaceId,
    {
      autentique_document_id: doc.id,
      autentique_document_name: doc.name,
      signature_status: driverStatus,
      signature_match_method: matchMethod,
      coop_signature_status: coopStatus,
      driver_email: driverEmail,
    },
    onTransition
  );
  return true;
}

export async function syncExpectedSignatureNameToTask(
  db: SupabaseClient,
  workspaceId: string,
  task: Record<string, unknown>,
  docsByName: Map<string, AutentiqueDocument>,
  onTransition: (ctx: SignatureTransitionContext) => Promise<void>
): Promise<boolean> {
  const meta = (task.metadata || {}) as Record<string, unknown>;
  const expected = String(meta.autentique_document_name_expected || '').trim();
  if (!expected) return false;

  const doc = docsByName.get(expected);
  if (!doc) return false;

  const { driverStatus, coopStatus, driverEmail } = signatureStatusFromDocument(doc);
  await applySignatureUpdateToTask(
    db,
    { ...task, workspace_id: workspaceId },
    workspaceId,
    {
      autentique_document_id: doc.id,
      autentique_document_name: doc.name,
      signature_status: driverStatus,
      signature_match_method: 'expected_name',
      coop_signature_status: coopStatus,
      driver_email: driverEmail,
    },
    onTransition
  );
  return true;
}

export async function runSignatureSyncForWorkspaceCore(
  db: SupabaseClient,
  workspaceId: string,
  onTransition: (ctx: SignatureTransitionContext) => Promise<void>
) {
  if (!canCallAutentiqueApi()) return { synced: 0, skipped: true as const };

  const { data: signatureTasks, error } = await db
    .from('pending_tasks')
    .select('id, task_type, title, assignee_id, driver_id, metadata, status, created_at')
    .eq('workspace_id', workspaceId)
    .in('task_type', [...SIGNATURE_TRACKED_TASK_TYPES]);
  if (error) throw new Error(error.message);

  const pendingTasks = (signatureTasks || []).filter((t) => {
    const taskStatus = String(t.status || '').trim().toLowerCase();
    if (taskStatus === 'cancelled' || taskStatus === 'canceled' || taskStatus === 'archived') return false;
    const meta = (t.metadata || {}) as Record<string, unknown>;
    const st = String(meta.signature_status || 'awaiting_document').toLowerCase();
    return st !== 'signed' && st !== 'document_finished' && st !== 'rejected';
  });
  if (!pendingTasks.length) return { synced: 0 };

  let docs: AutentiqueDocument[] = [];
  try {
    docs = await listAllAutentiqueDocuments();
  } catch {
    return { synced: 0, error: 'autentique_fetch_failed' };
  }

  const docsByName = new Map(docs.map((d) => [d.name, d]));
  let synced = 0;

  for (const doc of docs) {
    if (await syncAutentiqueDocumentToTasks(db, workspaceId, doc, onTransition)) synced += 1;
  }

  for (const task of pendingTasks) {
    if (await syncExpectedSignatureNameToTask(db, workspaceId, task, docsByName, onTransition)) {
      synced += 1;
    }
  }

  return { synced };
}
