import type { SupabaseClient } from '@supabase/supabase-js';
import { writeAuditLog } from './auditLog';

export type PharmacyOffboardingInput = {
  workspaceId: string;
  pharmacyId: string;
  actorId?: string | null;
  source?: string;
  reason?: string | null;
};

export type PharmacyOffboardingResult = {
  pharmacy_id: string;
  ended_driver_links: number;
  cleared_primary_drivers: number;
  ended_leader_links: number;
  cleared_sector_attendants: boolean;
};

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

function isTableMissingError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: string } | null)?.message || '').toLowerCase();
  return code === '42P01' || message.includes('does not exist') || message.includes('pharmacy_sector_attendants');
}

/**
 * Encerra vínculos operacionais ao inativar farmácia.
 * Reativar status para active não restaura vínculos — recadastro manual.
 */
export async function offboardPharmacy(
  db: SupabaseClient,
  input: PharmacyOffboardingInput,
): Promise<PharmacyOffboardingResult> {
  const { workspaceId, pharmacyId } = input;
  const endedAt = todayDateOnly();
  const nowIso = new Date().toISOString();

  const { data: activeDriverLinks, error: linksErr } = await db
    .from('driver_pharmacy_links')
    .select('id')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true);
  if (linksErr) throw new Error(linksErr.message);

  const endedDriverLinks = activeDriverLinks?.length || 0;
  if (endedDriverLinks > 0) {
    const { error: endLinksErr } = await db
      .from('driver_pharmacy_links')
      .update({ is_active: false, is_primary: false, ended_at: endedAt })
      .eq('pharmacy_id', pharmacyId)
      .eq('is_active', true);
    if (endLinksErr) throw new Error(endLinksErr.message);
  }

  const { data: driversWithPrimary, error: driversErr } = await db
    .from('drivers')
    .select('id')
    .eq('primary_pharmacy_id', pharmacyId);
  if (driversErr) throw new Error(driversErr.message);

  const clearedPrimaryDrivers = driversWithPrimary?.length || 0;
  if (clearedPrimaryDrivers > 0) {
    const { error: clearPrimaryErr } = await db
      .from('drivers')
      .update({ primary_pharmacy_id: null, updated_at: nowIso })
      .eq('primary_pharmacy_id', pharmacyId);
    if (clearPrimaryErr) throw new Error(clearPrimaryErr.message);
  }

  const { data: activeLeaderLinks, error: leaderLinksErr } = await db
    .from('leader_pharmacy_links')
    .select('id')
    .eq('pharmacy_id', pharmacyId)
    .eq('is_active', true);
  if (leaderLinksErr) throw new Error(leaderLinksErr.message);

  const endedLeaderLinks = activeLeaderLinks?.length || 0;
  if (endedLeaderLinks > 0) {
    const { error: endLeaderErr } = await db
      .from('leader_pharmacy_links')
      .update({ is_active: false })
      .eq('pharmacy_id', pharmacyId)
      .eq('is_active', true);
    if (endLeaderErr) throw new Error(endLeaderErr.message);
  }

  const { error: pharmacyClearErr } = await db
    .from('pharmacies')
    .update({
      leader_id: null,
      primary_attendant_id: null,
      secondary_attendant_id: null,
      updated_at: nowIso,
    })
    .eq('workspace_id', workspaceId)
    .eq('id', pharmacyId);
  if (pharmacyClearErr) throw new Error(pharmacyClearErr.message);

  let clearedSectorAttendants = true;
  const { error: sectorDelErr } = await db
    .from('pharmacy_sector_attendants')
    .delete()
    .eq('pharmacy_id', pharmacyId);
  if (sectorDelErr) {
    if (isTableMissingError(sectorDelErr)) {
      clearedSectorAttendants = false;
    } else {
      throw new Error(sectorDelErr.message);
    }
  }

  await writeAuditLog({
    actor_id: input.actorId || null,
    action: 'pharmacies.offboard',
    entity_type: 'pharmacy',
    entity_id: pharmacyId,
    workspace_id: workspaceId,
    metadata: {
      source: input.source || 'workspace_pharmacy_update',
      reason: input.reason || 'pharmacy_inactivated',
      ended_driver_links: endedDriverLinks,
      cleared_primary_drivers: clearedPrimaryDrivers,
      ended_leader_links: endedLeaderLinks,
      cleared_sector_attendants: clearedSectorAttendants,
    },
  });

  return {
    pharmacy_id: pharmacyId,
    ended_driver_links: endedDriverLinks,
    cleared_primary_drivers: clearedPrimaryDrivers,
    ended_leader_links: endedLeaderLinks,
    cleared_sector_attendants: clearedSectorAttendants,
  };
}
