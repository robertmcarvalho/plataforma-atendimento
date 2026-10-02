import type { SupabaseClient } from '@supabase/supabase-js';
import {
  defaultCoopEmail,
  defaultIgnoredSignerEmails,
  defaultLawyerEmail,
  runSignatureSyncForWorkspaceCore,
  syncAutentiqueDocumentToTasks,
  type AutentiqueDocument,
  type SignatureTransitionContext,
} from '@plataforma/operational-notes';
import { handleSignatureStatusTransition } from './signatureNotificationTasks';

async function onApiSignatureTransition(
  db: SupabaseClient,
  ctx: SignatureTransitionContext
): Promise<void> {
  await handleSignatureStatusTransition(db, {
    workspaceId: ctx.workspaceId,
    taskId: ctx.taskId,
    driverId: ctx.driverId,
    driverName: ctx.driverName,
    assigneeId: ctx.assigneeId,
    prevStatus: ctx.prevStatus,
    nextStatus: ctx.nextStatus,
  });
}

export async function runSignatureSyncForWorkspace(db: SupabaseClient, workspaceId: string) {
  return runSignatureSyncForWorkspaceCore(db, workspaceId, (ctx) =>
    onApiSignatureTransition(db, ctx)
  );
}

export async function processAutentiqueWebhookPayload(
  db: SupabaseClient,
  payload: Record<string, unknown>
) {
  const eventType = String(payload.type || payload.event || '').toLowerCase();
  const data = (payload.data || payload) as Record<string, unknown>;
  const object = (data.object || data.document || data) as Record<string, unknown>;
  const docName = String(object.name || object.document_name || '').trim();
  const docId = String(object.id || object.document_id || '').trim();

  if (!docName && !docId) return { handled: false };

  let doc: AutentiqueDocument | null = null;
  if (docName) {
    doc = {
      id: docId || 'webhook',
      name: docName,
      created_at: new Date().toISOString(),
      signatures: Array.isArray(object.signatures)
        ? (object.signatures as AutentiqueDocument['signatures'])
        : [],
    };
  }

  if (doc && doc.signatures.length === 0 && eventType.includes('signature')) {
    const email = String((object as { email?: string }).email || '').toLowerCase();
    const coop = defaultCoopEmail().toLowerCase();
    const lawyer = defaultLawyerEmail().toLowerCase();
    const ignored = new Set(defaultIgnoredSignerEmails());
    const isDriver = email && email !== coop && email !== lawyer && !ignored.has(email);
    let driverStatus = 'pending';
    if (eventType.includes('viewed')) driverStatus = 'awaiting_signature';
    if (eventType.includes('accepted')) driverStatus = 'signed';
    if (eventType.includes('rejected')) driverStatus = 'rejected';
    if (isDriver) {
      doc.signatures = [
        {
          email,
          signed: eventType.includes('accepted') ? { created_at: '' } : null,
          viewed: eventType.includes('viewed') ? { created_at: '' } : null,
          rejected: eventType.includes('rejected') ? { created_at: '' } : null,
        },
      ];
    }
  }

  if (!doc) return { handled: false };

  const { data: workspaces } = await db.from('workspaces').select('id').limit(50);
  let handled = false;
  for (const ws of workspaces || []) {
    const wsId = String(ws.id);
    if (await syncAutentiqueDocumentToTasks(db, wsId, doc, (ctx) => onApiSignatureTransition(db, ctx))) {
      handled = true;
    }
  }
  return { handled, eventType };
}

export async function recordWebhookIdempotency(
  db: SupabaseClient,
  workspaceId: string,
  eventId: string,
  eventType: string
): Promise<boolean> {
  const { error } = await db.from('processed_webhook_events').insert({
    meta_message_id: eventId,
    event_type: eventType,
    workspace_id: workspaceId,
  });
  if (error) {
    if (error.code === '23505') return false;
    throw new Error(error.message);
  }
  return true;
}
