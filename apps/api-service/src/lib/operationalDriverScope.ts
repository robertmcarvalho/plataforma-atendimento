import type { SupabaseClient } from '@supabase/supabase-js';

export const OPERATIONAL_SCOPE_TASK_TYPES = [
  'driver_registration_completion',
  'driver_enrollment_prep',
  'driver_enrollment',
  'driver_termination_prep',
  'driver_termination_request',
  'driver_termination_financial_review',
] as const;

const SIGNATURE_PENDING_FOR_PANEL = new Set(['pending', 'awaiting_signature', 'awaiting_view', 'waiting']);
const SIGNATURE_EMITTED_STATUSES = new Set([...SIGNATURE_PENDING_FOR_PANEL, 'signed', 'document_finished']);

export type OperationalDriverScope = {
  driverIds: Set<string>;
  pharmacyIdsByDriver: Map<string, string[]>;
};

function addDriverPharmacy(map: Map<string, string[]>, driverId: string, pharmacyId: string) {
  if (!driverId || !pharmacyId) return;
  const current = map.get(driverId) || [];
  if (!current.includes(pharmacyId)) current.push(pharmacyId);
  map.set(driverId, current);
}

export function pharmacyIdsFromOperationalMeta(meta: Record<string, unknown>): string[] {
  const primary = String(meta.primary_pharmacy_id || '').trim();
  const many = Array.isArray(meta.pharmacy_ids) ? meta.pharmacy_ids.map(String).filter(Boolean) : [];
  return [...new Set([primary, ...many].filter(Boolean))];
}

export function operationalMetaMatchesPharmacyScope(meta: Record<string, unknown>, pharmacyIds: string[]): boolean {
  if (!pharmacyIds.length) return true;
  const scope = new Set(pharmacyIds);
  return pharmacyIdsFromOperationalMeta(meta).some((id) => scope.has(id));
}

export function hasAutentiqueDocument(meta: Record<string, unknown>): boolean {
  return Boolean(
    String(meta.autentique_document_id || '').trim() ||
      String(meta.autentique_document_name || '').trim()
  );
}

export function signatureStatusFromOperationalMeta(meta: Record<string, unknown>): string {
  return String(meta.signature_status ?? meta.autentique_status ?? meta.document_signature_status ?? '')
    .toLowerCase()
    .trim();
}

export function isEnrollmentDocumentEmitted(meta: Record<string, unknown>): boolean {
  const status = signatureStatusFromOperationalMeta(meta);
  if (status === 'rejected' || status === 'awaiting_document') return false;
  return hasAutentiqueDocument(meta) || SIGNATURE_EMITTED_STATUSES.has(status);
}

export function isDocumentSignaturePendingForPanel(meta: Record<string, unknown>): boolean {
  const driver = signatureStatusFromOperationalMeta(meta);
  const coop = String(meta.coop_signature_status || '').toLowerCase().trim();
  if (driver === 'rejected' || coop === 'rejected' || driver === 'document_finished') return false;
  if (SIGNATURE_PENDING_FOR_PANEL.has(driver)) return hasAutentiqueDocument(meta);
  if ((driver === 'signed' || driver === 'document_finished') && SIGNATURE_PENDING_FOR_PANEL.has(coop)) return true;
  return false;
}

export async function loadOperationalDriverScope(
  db: SupabaseClient,
  workspaceId: string,
  pharmacyIds: string[],
  opts?: { includeTaskMetadata?: boolean }
): Promise<OperationalDriverScope> {
  const scopedPharmacyIds = [...new Set(pharmacyIds.filter(Boolean))];
  const driverIds = new Set<string>();
  const pharmacyIdsByDriver = new Map<string, string[]>();
  if (!scopedPharmacyIds.length) return { driverIds, pharmacyIdsByDriver };

  const { data: links, error: linksErr } = await db
    .from('driver_pharmacy_links')
    .select('driver_id, pharmacy_id')
    .eq('workspace_id', workspaceId)
    .in('pharmacy_id', scopedPharmacyIds)
    .eq('is_active', true);
  if (linksErr) throw new Error(linksErr.message);

  for (const link of links || []) {
    const driverId = link.driver_id ? String(link.driver_id) : '';
    const pharmacyId = link.pharmacy_id ? String(link.pharmacy_id) : '';
    if (!driverId || !pharmacyId) continue;
    driverIds.add(driverId);
    addDriverPharmacy(pharmacyIdsByDriver, driverId, pharmacyId);
  }

  const { data: primaryDrivers, error: primaryErr } = await db
    .from('drivers')
    .select('id, primary_pharmacy_id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .in('primary_pharmacy_id', scopedPharmacyIds);
  if (primaryErr) throw new Error(primaryErr.message);

  for (const driver of primaryDrivers || []) {
    const driverId = driver.id ? String(driver.id) : '';
    const pharmacyId = driver.primary_pharmacy_id ? String(driver.primary_pharmacy_id) : '';
    if (!driverId || !pharmacyId) continue;
    driverIds.add(driverId);
    addDriverPharmacy(pharmacyIdsByDriver, driverId, pharmacyId);
  }

  if (opts?.includeTaskMetadata !== false) {
    const { data: tasks, error: taskErr } = await db
      .from('pending_tasks')
      .select('driver_id, metadata')
      .eq('workspace_id', workspaceId)
      .in('task_type', [...OPERATIONAL_SCOPE_TASK_TYPES])
      .in('status', ['open', 'in_progress', 'done'])
      .limit(1000);
    if (taskErr) throw new Error(taskErr.message);

    for (const task of tasks || []) {
      const driverId = task.driver_id ? String(task.driver_id) : '';
      const meta =
        task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
          ? (task.metadata as Record<string, unknown>)
          : {};
      const matched = pharmacyIdsFromOperationalMeta(meta).filter((id) => scopedPharmacyIds.includes(id));
      if (!driverId || !matched.length) continue;
      driverIds.add(driverId);
      for (const pharmacyId of matched) addDriverPharmacy(pharmacyIdsByDriver, driverId, pharmacyId);
    }
  }

  return { driverIds, pharmacyIdsByDriver };
}
