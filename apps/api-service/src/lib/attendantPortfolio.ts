import type { SupabaseClient } from '@supabase/supabase-js';
import {
  assertPharmaciesInLeaderScope,
  getLeaderManagedPharmacyIds,
  isDriverInLeaderScope,
} from './leaderPortalScope';
import { loadOperationalDriverScope } from './operationalDriverScope';

function isSectorAttendantsTableMissing(err: { message?: string; code?: string } | null): boolean {
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '');
  return code === '42P01' || msg.includes('does not exist') || msg.includes('pharmacy_sector_attendants');
}

/** Farmácias na carteira do analista (primário, secundário ou atendente por setor). */
export async function getAttendantPortfolioPharmacyIds(
  db: SupabaseClient,
  workspaceId: string,
  attendantUserId: string
): Promise<string[]> {
  const ids = new Set<string>();

  const { data: primaryRows, error: pErr } = await db
    .from('pharmacies')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('primary_attendant_id', attendantUserId);
  if (pErr) throw new Error(pErr.message);
  for (const r of primaryRows || []) {
    if (r.id) ids.add(String(r.id));
  }

  const { data: secondaryRows, error: sErr } = await db
    .from('pharmacies')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('secondary_attendant_id', attendantUserId);
  if (sErr) throw new Error(sErr.message);
  for (const r of secondaryRows || []) {
    if (r.id) ids.add(String(r.id));
  }

  const { data: sectorRows, error: secErr } = await db
    .from('pharmacy_sector_attendants')
    .select('pharmacy_id')
    .eq('workspace_id', workspaceId)
    .eq('attendant_id', attendantUserId);
  if (secErr && !isSectorAttendantsTableMissing(secErr)) throw new Error(secErr.message);
  for (const r of sectorRows || []) {
    if (r.pharmacy_id) ids.add(String(r.pharmacy_id));
  }

  return Array.from(ids);
}

/** Líderes com pelo menos uma farmácia na carteira do analista. */
export async function getLeadersForAttendantPortfolio(
  db: SupabaseClient,
  workspaceId: string,
  pharmacyIds: string[]
): Promise<string[]> {
  if (!pharmacyIds.length) return [];

  const leaderIds = new Set<string>();

  const { data: pharmacies } = await db
    .from('pharmacies')
    .select('id, leader_id')
    .eq('workspace_id', workspaceId)
    .in('id', pharmacyIds);
  for (const p of pharmacies || []) {
    if (p.leader_id) leaderIds.add(String(p.leader_id));
  }

  const { data: links } = await db
    .from('leader_pharmacy_links')
    .select('leader_id')
    .eq('workspace_id', workspaceId)
    .in('pharmacy_id', pharmacyIds)
    .eq('is_active', true);
  for (const l of links || []) {
    if (l.leader_id) leaderIds.add(String(l.leader_id));
  }

  return Array.from(leaderIds);
}

/** Farmácias que estão na carteira do analista E na rede do líder. */
export async function intersectPortfolioWithLeader(
  db: SupabaseClient,
  attendantUserId: string,
  leaderId: string,
  workspaceId: string
): Promise<string[]> {
  const portfolio = new Set(await getAttendantPortfolioPharmacyIds(db, workspaceId, attendantUserId));
  const leaderPharmacies = await getLeaderManagedPharmacyIds(db, leaderId, workspaceId);
  return leaderPharmacies.filter((id) => portfolio.has(id));
}

export async function assertLeaderInAttendantPortfolio(
  db: SupabaseClient,
  workspaceId: string,
  attendantUserId: string,
  leaderId: string
): Promise<boolean> {
  const portfolio = await getAttendantPortfolioPharmacyIds(db, workspaceId, attendantUserId);
  const leaders = await getLeadersForAttendantPortfolio(db, workspaceId, portfolio);
  return leaders.includes(leaderId);
}

export async function assertOccurrenceScopeForAttendant(
  db: SupabaseClient,
  input: {
    workspaceId: string;
    attendantUserId: string;
    onBehalfOfLeaderId: string;
    pharmacyIds: string[];
    driverId: string;
    coveringDriverId?: string;
  }
): Promise<void> {
  const leaderOk = await assertLeaderInAttendantPortfolio(
    db,
    input.workspaceId,
    input.attendantUserId,
    input.onBehalfOfLeaderId
  );
  if (!leaderOk) throw new Error('Líder fora da sua carteira.');

  const allowedPharmacies = new Set(
    await intersectPortfolioWithLeader(db, input.attendantUserId, input.onBehalfOfLeaderId, input.workspaceId)
  );
  if (!input.pharmacyIds.every((id) => allowedPharmacies.has(id))) {
    throw new Error('Farmácia fora da sua carteira ou da rede do líder.');
  }

  const pharmaciesOk = await assertPharmaciesInLeaderScope(
    db,
    input.onBehalfOfLeaderId,
    input.pharmacyIds,
    input.workspaceId
  );
  if (!pharmaciesOk) throw new Error('Farmácia fora da rede do líder.');

  const driverOk = await isDriverInLeaderScope(db, input.onBehalfOfLeaderId, input.driverId);
  if (!driverOk) throw new Error('Entregador fora da rede do líder.');

  const portfolioIds = await getAttendantPortfolioPharmacyIds(db, input.workspaceId, input.attendantUserId);
  const scope = await loadOperationalDriverScope(db, input.workspaceId, portfolioIds);
  if (!scope.driverIds.has(input.driverId)) throw new Error('Entregador fora da sua carteira.');

  if (input.coveringDriverId) {
    const covLeaderOk = await isDriverInLeaderScope(db, input.onBehalfOfLeaderId, input.coveringDriverId);
    if (!covLeaderOk) throw new Error('Entregador cobridor fora da rede do líder.');
    if (!scope.driverIds.has(input.coveringDriverId)) throw new Error('Entregador cobridor fora da sua carteira.');
  }
}

export async function assertLifecycleScopeForAttendant(
  db: SupabaseClient,
  input: {
    workspaceId: string;
    attendantUserId: string;
    onBehalfOfLeaderId: string;
    pharmacyIds: string[];
    driverId?: string;
  }
): Promise<void> {
  const leaderOk = await assertLeaderInAttendantPortfolio(
    db,
    input.workspaceId,
    input.attendantUserId,
    input.onBehalfOfLeaderId
  );
  if (!leaderOk) throw new Error('Líder fora da sua carteira.');

  const allowedPharmacies = new Set(
    await intersectPortfolioWithLeader(db, input.attendantUserId, input.onBehalfOfLeaderId, input.workspaceId)
  );
  if (!input.pharmacyIds.every((id) => allowedPharmacies.has(id))) {
    throw new Error('Farmácia fora da sua carteira ou da rede do líder.');
  }

  const pharmaciesOk = await assertPharmaciesInLeaderScope(
    db,
    input.onBehalfOfLeaderId,
    input.pharmacyIds,
    input.workspaceId
  );
  if (!pharmaciesOk) throw new Error('Farmácia fora da rede do líder.');

  if (input.driverId) {
    const driverOk = await isDriverInLeaderScope(db, input.onBehalfOfLeaderId, input.driverId);
    if (!driverOk) throw new Error('Entregador fora da rede do líder.');

    const portfolioIds = await getAttendantPortfolioPharmacyIds(db, input.workspaceId, input.attendantUserId);
    const scope = await loadOperationalDriverScope(db, input.workspaceId, portfolioIds);
    if (!scope.driverIds.has(input.driverId)) throw new Error('Entregador fora da sua carteira.');
  }
}
