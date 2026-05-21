import type { SupabaseClient } from '@supabase/supabase-js';

export const LEADER_DRIVER_YES_ID = 'leader_driver_yes';
export const LEADER_DRIVER_NO_ID = 'leader_driver_no';
export const LEADER_DRIVER_NONE_ID = 'leader_driver_none';

export type LeaderDriverOption = { id: string; name: string };

export async function getDriversAtPharmacyForLeader(
  db: SupabaseClient,
  pharmacyId: string
): Promise<LeaderDriverOption[]> {
  const pid = String(pharmacyId || '').trim();
  if (!pid) return [];

  const { data: links, error: linkErr } = await db
    .from('driver_pharmacy_links')
    .select('driver_id')
    .eq('pharmacy_id', pid)
    .eq('is_active', true);
  if (linkErr) throw new Error(linkErr.message);

  const driverIds = Array.from(new Set((links || []).map((r) => String(r.driver_id || '')).filter(Boolean)));
  if (!driverIds.length) return [];

  const { data: drivers, error: drvErr } = await db
    .from('drivers')
    .select('id, name')
    .in('id', driverIds)
    .eq('status', 'active')
    .order('name');
  if (drvErr) throw new Error(drvErr.message);

  return (drivers || []).map((d) => ({
    id: String(d.id),
    name: String(d.name || 'Entregador').trim(),
  }));
}

export async function isDriverLinkedToPharmacy(
  db: SupabaseClient,
  pharmacyId: string,
  driverId: string
): Promise<boolean> {
  if (!pharmacyId?.trim() || !driverId?.trim()) return false;
  const { data } = await db
    .from('driver_pharmacy_links')
    .select('id')
    .eq('pharmacy_id', pharmacyId)
    .eq('driver_id', driverId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  return !!data?.id;
}

/** Até 9 entregadores + linha "Não está na lista" (máx. 10 linhas WhatsApp). */
export function buildLeaderDriverListRows(drivers: LeaderDriverOption[]): Array<{ id: string; title: string }> {
  const maxDrivers = 9;
  const rows = drivers.slice(0, maxDrivers).map((d) => ({
    id: d.id,
    title: d.name,
  }));
  rows.push({ id: LEADER_DRIVER_NONE_ID, title: 'Não está na lista' });
  return rows;
}

export function needsNumberedLeaderDriverMenu(drivers: LeaderDriverOption[]): boolean {
  return drivers.length > 9;
}

export type LeaderPharmacyRow = { pharmacy_id: string; pharmacies: { trade_name: string } };

export function normalizeLeaderPharmacyRows(raw: unknown): LeaderPharmacyRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row: unknown) => {
      const r = row as { pharmacy_id?: string; pharmacies?: unknown };
      const p = r.pharmacies;
      let trade = 'Farmácia';
      if (p && typeof p === 'object' && !Array.isArray(p) && 'trade_name' in p) {
        trade = String((p as { trade_name?: string }).trade_name || trade);
      } else if (Array.isArray(p) && p[0] && typeof p[0] === 'object' && 'trade_name' in p[0]) {
        trade = String((p[0] as { trade_name?: string }).trade_name || trade);
      }
      return {
        pharmacy_id: String(r.pharmacy_id || ''),
        pharmacies: { trade_name: trade },
      };
    })
    .filter((r) => r.pharmacy_id.length > 0);
}
