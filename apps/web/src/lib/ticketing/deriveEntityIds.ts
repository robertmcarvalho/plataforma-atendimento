export type EntityIds = {
  driver_id: string | null;
  pharmacy_id: string | null;
  leader_id: string | null;
};

/** Aligns with conversation detail resolution used in Inbox (cadastro / context_*). */
export function deriveEntityIdsFromDetail(detail: unknown): EntityIds {
  if (!detail || typeof detail !== 'object') {
    return { driver_id: null, pharmacy_id: null, leader_id: null };
  }
  const d = detail as Record<string, unknown>;
  const c = d.contacts as Record<string, unknown> | null | undefined;

  let driver_id: string | null = null;
  let pharmacy_id: string | null = null;
  let leader_id: string | null = null;

  const ctxDriver = d.context_driver as { id?: string } | null | undefined;
  const ctxPharmacy = d.context_pharmacy as { id?: string } | null | undefined;
  const ctxLeader = d.context_leader as { id?: string } | null | undefined;

  if (ctxDriver?.id) {
    driver_id = ctxDriver.id;
  } else if (ctxPharmacy?.id) {
    pharmacy_id = ctxPharmacy.id;
  } else if (ctxLeader?.id) {
    leader_id = ctxLeader.id;
  } else if (c) {
    const pt = String(c.profile_type || '');
    if (pt === 'driver' && c.driver_id) driver_id = String(c.driver_id);
    else if (pt === 'pharmacy' && c.pharmacy_id) pharmacy_id = String(c.pharmacy_id);
    else if (pt === 'leader' && c.leader_id) leader_id = String(c.leader_id);
  }

  return { driver_id, pharmacy_id, leader_id };
}
