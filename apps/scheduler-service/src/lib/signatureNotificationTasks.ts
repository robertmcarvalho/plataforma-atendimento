import type { SupabaseClient } from '@supabase/supabase-js';
import type { SignaturePrefKey } from './notificationPreferences';

export type SignatureNotifEvent = SignaturePrefKey;

/** Assinaturas aparecem em `signature_pending` do hub — não criar pending_tasks. */
export async function createSignatureNotificationIfNeeded(
  _db: SupabaseClient,
  _args: {
    workspaceId: string;
    parentTaskId: string;
    driverId: string;
    driverName: string;
    assigneeId: string | null;
    event: SignatureNotifEvent;
    description?: string;
  }
): Promise<void> {
  return;
}
