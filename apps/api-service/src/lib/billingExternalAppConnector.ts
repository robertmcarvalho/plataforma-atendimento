import { supabase } from './supabase';

export function isBillingExternalAppEnabled(): boolean {
  return Boolean(process.env.BILLING_EXTERNAL_APP_TOKEN?.trim());
}

export function validateBillingExternalAppToken(headerValue: string | undefined): boolean {
  const expected = process.env.BILLING_EXTERNAL_APP_TOKEN?.trim();
  if (!expected) return false;
  return headerValue === expected;
}

export type ExternalDeliveryInput = {
  pharmacy_id: string;
  driver_id: string;
  delivered_at: string;
  document_number?: string | null;
  route_id?: string | null;
  external_id: string;
  cancelled?: boolean;
};

export async function ingestExternalAppDeliveries(
  workspaceId: string,
  deliveries: ExternalDeliveryInput[]
): Promise<{ imported: number; skipped: number }> {
  if (!deliveries.length) return { imported: 0, skipped: 0 };

  const now = new Date().toISOString();
  const inserts = deliveries.map((d) => ({
    workspace_id: workspaceId,
    pharmacy_id: d.pharmacy_id,
    driver_id: d.driver_id,
    delivered_at: d.delivered_at.includes('T')
      ? new Date(d.delivered_at).toISOString()
      : new Date(`${d.delivered_at.slice(0, 10)}T12:00:00.000Z`).toISOString(),
    document_number: d.document_number?.trim() || null,
    route_id: d.route_id?.trim() || null,
    source: 'external_app' as const,
    external_id: d.external_id.trim(),
    cancelled: d.cancelled === true,
    verified: true,
    updated_at: now,
  }));

  const { data, error } = await supabase
    .from('billing_delivery_records')
    .upsert(inserts, { onConflict: 'workspace_id,source,external_id', ignoreDuplicates: true })
    .select('id');
  if (error) throw new Error(error.message);

  const imported = (data || []).length;
  return { imported, skipped: deliveries.length - imported };
}
