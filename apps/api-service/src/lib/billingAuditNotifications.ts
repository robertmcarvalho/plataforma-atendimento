import { supabase } from './supabase';

export type BillingAuditSeverity = 'info' | 'warning' | 'critical';

export async function addBillingAuditNotification(input: {
  workspaceId: string;
  billingCycleId?: string | null;
  pharmacyId?: string | null;
  driverId?: string | null;
  severity: BillingAuditSeverity;
  code: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.from('billing_audit_notifications').insert({
    workspace_id: input.workspaceId,
    billing_cycle_id: input.billingCycleId || null,
    pharmacy_id: input.pharmacyId || null,
    driver_id: input.driverId || null,
    severity: input.severity,
    code: input.code,
    title: input.title,
    message: input.message,
    metadata: input.metadata || {},
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export async function clearCycleAuditNotifications(
  workspaceId: string,
  billingCycleId: string,
  pharmacyId?: string
): Promise<void> {
  let query = supabase
    .from('billing_audit_notifications')
    .update({ status: 'resolved', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('billing_cycle_id', billingCycleId)
    .eq('status', 'open');
  if (pharmacyId) query = query.eq('pharmacy_id', pharmacyId);
  const { error } = await query;
  if (error) throw new Error(error.message);
}
