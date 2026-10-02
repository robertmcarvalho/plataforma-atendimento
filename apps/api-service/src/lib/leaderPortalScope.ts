import type { SupabaseClient } from '@supabase/supabase-js';

/** Farmácias geridas pelo líder: links ativos OU pharmacies.leader_id (sempre no workspace do líder). */
export async function getLeaderManagedPharmacyIds(
  db: SupabaseClient,
  leaderId: string,
  workspaceId?: string | null
): Promise<string[]> {
  let wsId = workspaceId?.trim() || '';
  if (!wsId) {
    const { data: leaderRow } = await db.from('leaders').select('workspace_id').eq('id', leaderId).maybeSingle();
    wsId = String(leaderRow?.workspace_id || '').trim();
  }
  if (!wsId) return [];

  const [{ data: linkRows }, { data: fkRows }] = await Promise.all([
    db.from('leader_pharmacy_links').select('pharmacy_id').eq('leader_id', leaderId).eq('is_active', true),
    db.from('pharmacies').select('id').eq('leader_id', leaderId).eq('workspace_id', wsId),
  ]);

  const ids = new Set<string>();
  for (const r of linkRows || []) {
    if (r.pharmacy_id) ids.add(String(r.pharmacy_id));
  }
  for (const r of fkRows || []) {
    if (r.id) ids.add(String(r.id));
  }
  if (!ids.size) return [];

  const { data: scoped } = await db.from('pharmacies').select('id').eq('workspace_id', wsId).in('id', Array.from(ids));
  return (scoped || []).map((r) => String(r.id));
}

/** Valida que todas as farmácias pertencem à rede do líder. */
export async function assertPharmaciesInLeaderScope(
  db: SupabaseClient,
  leaderId: string,
  pharmacyIds: string[],
  workspaceId?: string | null
): Promise<boolean> {
  if (!pharmacyIds.length) return false;
  const managed = new Set(await getLeaderManagedPharmacyIds(db, leaderId, workspaceId));
  return pharmacyIds.every((id) => managed.has(id));
}

/** Entregador pertence à rede do líder se existe vínculo ativo em alguma farmácia gerida. */
export async function isDriverInLeaderScope(
  db: SupabaseClient,
  leaderId: string,
  driverId: string
): Promise<boolean> {
  const pharmacyIds = await getLeaderManagedPharmacyIds(db, leaderId);
  if (!pharmacyIds.length) return false;
  const { data } = await db
    .from('driver_pharmacy_links')
    .select('id')
    .eq('driver_id', driverId)
    .in('pharmacy_id', pharmacyIds)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  return !!data;
}

export type PharmacyWithDriversRow = {
  pharmacy_id: string;
  trade_name: string;
  city: string | null;
  drivers: Array<{ id: string; name: string; phone: string; is_primary: boolean }>;
};

/** Agrupa entregadores ativos por farmácia via driver_pharmacy_links ativos. */
export async function buildPharmaciesWithDriversForLeader(
  db: SupabaseClient,
  leaderId: string
): Promise<PharmacyWithDriversRow[]> {
  const pharmacyIds = await getLeaderManagedPharmacyIds(db, leaderId);
  if (!pharmacyIds.length) return [];

  const { data: pharmacies, error: pErr } = await db
    .from('pharmacies')
    .select('id, trade_name, city')
    .in('id', pharmacyIds)
    .order('trade_name');
  if (pErr || !pharmacies?.length) return [];

  const { data: links } = await db
    .from('driver_pharmacy_links')
    .select('driver_id, pharmacy_id, is_primary')
    .in('pharmacy_id', pharmacyIds)
    .eq('is_active', true);

  const driverIds = Array.from(new Set((links || []).map((l) => l.driver_id).filter(Boolean)));
  if (!driverIds.length) {
    return pharmacies.map((p) => ({
      pharmacy_id: p.id,
      trade_name: p.trade_name,
      city: p.city ?? null,
      drivers: [],
    }));
  }

  const { data: drivers } = await db
    .from('drivers')
    .select('id, name, phone, status')
    .in('id', driverIds)
    .eq('status', 'active');

  const driverMap = new Map((drivers || []).map((d) => [d.id, d]));
  const byPharmacy = new Map<string, PharmacyWithDriversRow['drivers']>();

  for (const link of links || []) {
    const d = driverMap.get(link.driver_id);
    if (!d) continue;
    const list = byPharmacy.get(link.pharmacy_id) || [];
    list.push({
      id: d.id,
      name: d.name,
      phone: d.phone,
      is_primary: !!link.is_primary,
    });
    byPharmacy.set(link.pharmacy_id, list);
  }

  return pharmacies.map((p) => ({
    pharmacy_id: p.id,
    trade_name: p.trade_name,
    city: p.city ?? null,
    drivers: byPharmacy.get(p.id) || [],
  }));
}

/** Endereço em uma linha para cards do wizard do portal líder (paridade Revive). */
export function formatLeaderPharmacyAddressLine(row: Record<string, unknown>): string | null {
  const street = [row.address_street, row.address_number]
    .filter((x) => x != null && String(x).trim())
    .map((x) => String(x).trim())
    .join(', ');
  const hood = row.address_neighborhood ? String(row.address_neighborhood).trim() : '';
  const city = row.address_city || row.city ? String(row.address_city || row.city).trim() : '';
  const line = [street, hood].filter(Boolean).join(', ');
  if (line && city) return `${line} — ${city}`;
  return line || city || null;
}

/** Lista entregadores ativos na rede do líder (via driver_pharmacy_links) + IDs de farmácias vinculadas para filtros na UI. */
export async function getDriversForLeaderPortal(db: SupabaseClient, leaderId: string) {
  const pharmacyIds = await getLeaderManagedPharmacyIds(db, leaderId);
  if (!pharmacyIds.length) return [];

  const { data: links } = await db
    .from('driver_pharmacy_links')
    .select('driver_id, pharmacy_id')
    .in('pharmacy_id', pharmacyIds)
    .eq('is_active', true);

  const driverToPharmacies = new Map<string, Set<string>>();
  for (const l of links || []) {
    let set = driverToPharmacies.get(l.driver_id);
    if (!set) {
      set = new Set<string>();
      driverToPharmacies.set(l.driver_id, set);
    }
    set.add(String(l.pharmacy_id));
  }

  const driverIds = Array.from(driverToPharmacies.keys());
  if (!driverIds.length) return [];

  const wsFromLeader = await db.from('leaders').select('workspace_id').eq('id', leaderId).maybeSingle();
  const wsId = String(wsFromLeader.data?.workspace_id || '').trim();

  let driversQuery = db
    .from('drivers')
    .select('*, primary_pharmacy:pharmacies!primary_pharmacy_id(trade_name)')
    .in('id', driverIds)
    .eq('status', 'active');
  if (wsId) driversQuery = driversQuery.eq('workspace_id', wsId);
  const { data: drivers } = await driversQuery;

  return (drivers || []).map((d: Record<string, unknown>) => ({
    ...d,
    leader_linked_pharmacy_ids: Array.from(driverToPharmacies.get(String(d.id)) || []),
  }));
}
