import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildPortfolioOperationsHub,
  buildWorkspaceOperationsHub,
  type OpsHubQueryOpts,
  type OpsOperationsHub,
} from './opsAnalyticsAggregate';

const OPERACIONAL_SECTOR = 'Operacional';

export type GestorOperacionalAttendant = {
  id: string;
  name: string;
};

async function resolveOperacionalSectorId(
  db: SupabaseClient,
  workspaceId: string
): Promise<string | null> {
  const { data: sector } = await db
    .from('sectors')
    .select('id')
    .eq('workspace_id', workspaceId)
    .ilike('name', OPERACIONAL_SECTOR)
    .limit(1)
    .maybeSingle();
  return sector?.id ? String(sector.id) : null;
}

async function listActiveWorkspaceMemberIds(
  db: SupabaseClient,
  workspaceId: string
): Promise<Set<string>> {
  const { data, error } = await db
    .from('workspace_memberships')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true);
  if (error) throw new Error(error.message);
  return new Set((data || []).map((r) => String(r.user_id)).filter(Boolean));
}

function workspaceRoleName(
  roles: { name?: string } | { name?: string }[] | null | undefined
): string {
  const row = Array.isArray(roles) ? roles[0] : roles;
  return String(row?.name || '').toLowerCase();
}

/** Descobre analistas operacionais por setor, carteira de farmácias ou papel attendant/operational no workspace. */
async function discoverOperacionalAnalystIds(
  db: SupabaseClient,
  workspaceId: string
): Promise<string[]> {
  const memberIds = await listActiveWorkspaceMemberIds(db, workspaceId);
  if (!memberIds.size) return [];

  const ids = new Set<string>();
  const sectorId = await resolveOperacionalSectorId(db, workspaceId);

  if (sectorId) {
    const { data: links, error: linkErr } = await db
      .from('user_sectors')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('sector_id', sectorId);
    if (linkErr) throw new Error(linkErr.message);
    for (const r of links || []) {
      const uid = r.user_id ? String(r.user_id) : '';
      if (uid && memberIds.has(uid)) ids.add(uid);
    }

    const { data: byPrimarySector, error: sectorUserErr } = await db
      .from('users')
      .select('id')
      .eq('sector_id', sectorId)
      .eq('is_active', true);
    if (sectorUserErr) throw new Error(sectorUserErr.message);
    for (const u of byPrimarySector || []) {
      const uid = u.id ? String(u.id) : '';
      if (uid && memberIds.has(uid)) ids.add(uid);
    }
  }

  const { data: pharmRows, error: pharmErr } = await db
    .from('pharmacies')
    .select('primary_attendant_id, secondary_attendant_id')
    .eq('workspace_id', workspaceId);
  if (pharmErr) throw new Error(pharmErr.message);
  for (const p of pharmRows || []) {
    if (p.primary_attendant_id) {
      const uid = String(p.primary_attendant_id);
      if (memberIds.has(uid)) ids.add(uid);
    }
    if (p.secondary_attendant_id) {
      const uid = String(p.secondary_attendant_id);
      if (memberIds.has(uid)) ids.add(uid);
    }
  }

  if (!ids.size) return [];

  const { data: memberships, error: membershipErr } = await db
    .from('workspace_memberships')
    .select('user_id, roles(name)')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .in('user_id', Array.from(ids));
  if (membershipErr) throw new Error(membershipErr.message);

  const analystIds: string[] = [];
  for (const membership of memberships || []) {
    const roleName = workspaceRoleName(
      membership.roles as { name?: string } | { name?: string }[] | null
    );
    if (roleName === 'attendant' || roleName === 'operational') {
      analystIds.push(String(membership.user_id));
    }
  }

  return analystIds;
}

export async function listOperacionalAttendants(
  db: SupabaseClient,
  workspaceId: string
): Promise<GestorOperacionalAttendant[]> {
  const analystIds = await discoverOperacionalAnalystIds(db, workspaceId);
  if (!analystIds.length) return [];

  const { data: users, error: userErr } = await db
    .from('users')
    .select('id, name')
    .in('id', analystIds)
    .eq('is_active', true);
  if (userErr) throw new Error(userErr.message);

  return (users || [])
    .map((u) => ({ id: String(u.id), name: String(u.name || 'Analista') }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export async function buildGestorOperacionalHub(
  db: SupabaseClient,
  workspaceId: string,
  periodDays = 30,
  attendantId?: string | null,
  opts?: OpsHubQueryOpts
): Promise<OpsOperationsHub & { attendants_scope: number }> {
  const attendants = await listOperacionalAttendants(db, workspaceId);

  if (attendantId) {
    const hub = await buildPortfolioOperationsHub(db, workspaceId, attendantId, periodDays, opts);
    return { ...hub, attendants_scope: 1 };
  }

  const hub = await buildWorkspaceOperationsHub(db, workspaceId, periodDays, opts);
  return { ...hub, attendants_scope: attendants.length };
}
