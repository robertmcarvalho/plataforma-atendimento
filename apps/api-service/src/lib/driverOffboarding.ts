import type { SupabaseClient } from '@supabase/supabase-js';
import { writeAuditLog } from './auditLog';
import { createDriverOffboardingPreview, type BillingDriverOffboardingPreviewResult } from './billingDriverOffboardingPreview';

export type DriverOffboardingInput = {
  driverId: string;
  lastWorkedAt: string;
  actorId?: string | null;
  source?: string;
  reason?: string | null;
  notes?: string | null;
  taskId?: string | null;
};

export type DriverOffboardingResult = {
  driver_id: string;
  ended_pharmacy_ids: string[];
  ended_links_count: number;
  status: 'inactive';
  billing_preview?: BillingDriverOffboardingPreviewResult | null;
};

function normalizeDateOnly(value: string): string {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

export type EndDriverPharmacyLinksResult = {
  ended_pharmacy_ids: string[];
  ended_links_count: number;
};

/** Encerra vínculos ativos (ou inconsistentes com ended_at) do entregador. */
export async function endDriverPharmacyLinks(
  db: SupabaseClient,
  input: { driverId: string; endedAt?: string },
): Promise<EndDriverPharmacyLinksResult> {
  const endedAt = normalizeDateOnly(input.endedAt || new Date().toISOString());

  const { data: openLinks, error: linksErr } = await db
    .from('driver_pharmacy_links')
    .select('id, pharmacy_id')
    .eq('driver_id', input.driverId)
    .eq('is_active', true);
  if (linksErr) throw new Error(linksErr.message);

  const toEnd = openLinks || [];
  const endedPharmacyIds = Array.from(new Set(toEnd.map((l) => String(l.pharmacy_id)).filter(Boolean)));

  if (toEnd.length) {
    const { error: endLinksErr } = await db
      .from('driver_pharmacy_links')
      .update({
        is_active: false,
        is_primary: false,
        ended_at: endedAt,
      })
      .eq('driver_id', input.driverId)
      .in(
        'id',
        toEnd.map((row) => String(row.id)),
      );
    if (endLinksErr) throw new Error(endLinksErr.message);
  }

  return {
    ended_pharmacy_ids: endedPharmacyIds,
    ended_links_count: toEnd.length,
  };
}

export async function offboardDriver(
  db: SupabaseClient,
  input: DriverOffboardingInput
): Promise<DriverOffboardingResult> {
  const endedAt = normalizeDateOnly(input.lastWorkedAt);
  const nowIso = new Date().toISOString();

  const { data: driver, error: driverErr } = await db
    .from('drivers')
    .select('id, workspace_id, name, status, primary_pharmacy_id, override_leader_id')
    .eq('id', input.driverId)
    .single();
  if (driverErr || !driver) {
    throw new Error('Entregador não encontrado');
  }

  const { ended_pharmacy_ids: endedPharmacyIds, ended_links_count } = await endDriverPharmacyLinks(db, {
    driverId: input.driverId,
    endedAt,
  });

  const { error: updDriverErr } = await db
    .from('drivers')
    .update({
      status: 'inactive',
      inactive_at: endedAt,
      termination_reason: input.reason?.trim() || null,
      primary_pharmacy_id: null,
      override_leader_id: null,
      updated_at: nowIso,
    })
    .eq('id', input.driverId);
  if (updDriverErr) throw new Error(updDriverErr.message);

  let billingPreview: BillingDriverOffboardingPreviewResult | null = null;
  try {
    billingPreview = await createDriverOffboardingPreview(db, {
      workspaceId: String(driver.workspace_id),
      driverId: input.driverId,
      lastWorkedAt: endedAt,
      actorId: input.actorId || null,
      taskId: input.taskId || null,
      endedPharmacyIds,
    });
  } catch (err) {
    billingPreview = null;
  }

  await writeAuditLog({
    actor_id: input.actorId || null,
    action: 'drivers.offboard',
    entity_type: 'driver',
    entity_id: input.driverId,
    metadata: {
      source: input.source || 'system',
      task_id: input.taskId || null,
      reason: input.reason || null,
      notes: input.notes || null,
      last_worked_at: endedAt,
      previous_status: driver.status || null,
      previous_primary_pharmacy_id: driver.primary_pharmacy_id || null,
      previous_override_leader_id: driver.override_leader_id || null,
      ended_pharmacy_ids: endedPharmacyIds,
      ended_links_count,
      billing_preview_id: billingPreview?.id || null,
    },
  });

  return {
    driver_id: input.driverId,
    ended_pharmacy_ids: endedPharmacyIds,
    ended_links_count,
    status: 'inactive',
    billing_preview: billingPreview,
  };
}
