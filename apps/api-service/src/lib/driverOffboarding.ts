import type { SupabaseClient } from '@supabase/supabase-js';
import { writeAuditLog } from './auditLog';

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
};

function normalizeDateOnly(value: string): string {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

export async function offboardDriver(
  db: SupabaseClient,
  input: DriverOffboardingInput
): Promise<DriverOffboardingResult> {
  const endedAt = normalizeDateOnly(input.lastWorkedAt);
  const nowIso = new Date().toISOString();

  const { data: driver, error: driverErr } = await db
    .from('drivers')
    .select('id, name, status, primary_pharmacy_id, override_leader_id')
    .eq('id', input.driverId)
    .single();
  if (driverErr || !driver) {
    throw new Error('Entregador não encontrado');
  }

  const { data: activeLinks, error: linksErr } = await db
    .from('driver_pharmacy_links')
    .select('id, pharmacy_id')
    .eq('driver_id', input.driverId)
    .eq('is_active', true);
  if (linksErr) throw new Error(linksErr.message);

  const endedPharmacyIds = Array.from(new Set((activeLinks || []).map((l) => String(l.pharmacy_id)).filter(Boolean)));

  if (endedPharmacyIds.length) {
    const { error: endLinksErr } = await db
      .from('driver_pharmacy_links')
      .update({
        is_active: false,
        ended_at: endedAt,
      })
      .eq('driver_id', input.driverId)
      .eq('is_active', true);
    if (endLinksErr) throw new Error(endLinksErr.message);
  }

  const { error: updDriverErr } = await db
    .from('drivers')
    .update({
      status: 'inactive',
      primary_pharmacy_id: null,
      override_leader_id: null,
      updated_at: nowIso,
    })
    .eq('id', input.driverId);
  if (updDriverErr) throw new Error(updDriverErr.message);

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
      ended_links_count: activeLinks?.length || 0,
    },
  });

  return {
    driver_id: input.driverId,
    ended_pharmacy_ids: endedPharmacyIds,
    ended_links_count: activeLinks?.length || 0,
    status: 'inactive',
  };
}
