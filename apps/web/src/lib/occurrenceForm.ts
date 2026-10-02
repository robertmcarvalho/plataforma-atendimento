import {
  OccurrenceKind as OccurrenceKindConst,
  type OccurrenceKindValue,
} from '@plataforma/operational-notes';

export type OccurrenceKind = OccurrenceKindValue;
export { OccurrenceKindConst };
export type OccurrenceShift = 'full' | 'morning' | 'afternoon' | 'night';

export type OccurrencePayload = {
  driver_id: string;
  pharmacy_ids: string[];
  event_date: string;
  shift?: OccurrenceShift;
  occurrence_kind: OccurrenceKind;
  has_coverage: boolean;
  coverage?: { covering_driver_id: string; amount: number; notes?: string };
  contracted_daily?: { amount: number; notes?: string };
  reason?: string;
  on_behalf_of_leader_id?: string;
};

export type OccurrenceDriverOption = {
  id: string;
  name: string;
  primary_pharmacy_id?: string | null;
  leader_linked_pharmacy_ids?: string[];
  driver_pharmacy_links?: Array<{ is_active?: boolean; pharmacies?: { id: string } | null }>;
};

export type OccurrencePharmacyOption = {
  id: string;
  trade_name: string;
  leader_id?: string | null;
  leader_name?: string | null;
};

export function resolveLeaderFromPharmacySelection(
  pharmacyIds: string[],
  pharmacies: OccurrencePharmacyOption[],
  driver: OccurrenceDriverOption | null
): { leaderId: string | null; leaderName: string | null } {
  const orderedIds = pharmacyIds.length
    ? pharmacyIds
    : defaultPharmacyIdsForOccurrenceDriver(driver, pharmacies);
  for (const id of orderedIds) {
    const row = pharmacies.find((p) => p.id === id);
    if (row?.leader_id) {
      return { leaderId: row.leader_id, leaderName: row.leader_name || null };
    }
  }
  return { leaderId: null, leaderName: null };
}

export function defaultPharmacyIdsForOccurrenceDriver(
  driver: OccurrenceDriverOption | null,
  pharmacies: OccurrencePharmacyOption[]
): string[] {
  if (!driver) return [];
  const preferred = (driver.leader_linked_pharmacy_ids || []).filter(Boolean);
  if (preferred.length) return preferred;
  const linked = new Set<string>();
  if (driver.primary_pharmacy_id) linked.add(driver.primary_pharmacy_id);
  for (const row of driver.driver_pharmacy_links || []) {
    if (row.is_active !== false && row.pharmacies?.id) linked.add(row.pharmacies.id);
  }
  if (!linked.size) return [];
  return pharmacies.filter((p) => linked.has(p.id)).map((p) => p.id);
}

export function pharmaciesForOccurrenceDriver(
  driver: OccurrenceDriverOption | null,
  allPharmacies: OccurrencePharmacyOption[]
): OccurrencePharmacyOption[] {
  const ids = new Set(defaultPharmacyIdsForOccurrenceDriver(driver, allPharmacies));
  return allPharmacies.filter((p) => ids.has(p.id));
}
