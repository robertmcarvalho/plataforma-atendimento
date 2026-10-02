import type { SupabaseClient } from '@supabase/supabase-js';
import { MACRO_SECTOR_NAMES } from './gestorScope';

const GESTOR_ROLES = new Set(['supervisor', 'financial']);

function workspaceRoleName(
  roles: { name?: string } | { name?: string }[] | null | undefined
): string {
  const row = Array.isArray(roles) ? roles[0] : roles;
  return String(row?.name || '').toLowerCase();
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

async function listGestorUserIdsInWorkspace(
  db: SupabaseClient,
  workspaceId: string
): Promise<Set<string>> {
  const { data, error } = await db
    .from('workspace_memberships')
    .select('user_id, roles(name)')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true);
  if (error) throw new Error(error.message);

  const ids = new Set<string>();
  for (const row of data || []) {
    const role = workspaceRoleName(row.roles as { name?: string } | { name?: string }[] | null);
    if (GESTOR_ROLES.has(role)) ids.add(String(row.user_id));
  }
  return ids;
}

export async function resolveSectorIdByName(
  db: SupabaseClient,
  workspaceId: string,
  sectorName: string
): Promise<string | null> {
  const { data, error } = await db
    .from('sectors')
    .select('id')
    .eq('workspace_id', workspaceId)
    .ilike('name', sectorName)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id ? String(data.id) : null;
}

/** Gestor (`supervisor` ou legado `financial`) vinculado ao setor informado. */
export async function resolveGestorUserIdForSectorId(
  db: SupabaseClient,
  workspaceId: string,
  sectorId: string
): Promise<string | null> {
  const memberIds = await listActiveWorkspaceMemberIds(db, workspaceId);
  if (!memberIds.size) return null;

  const gestorIds = await listGestorUserIdsInWorkspace(db, workspaceId);

  const { data: links, error: linkErr } = await db
    .from('user_sectors')
    .select('user_id, is_primary')
    .eq('workspace_id', workspaceId)
    .eq('sector_id', sectorId)
    .order('is_primary', { ascending: false });
  if (linkErr) throw new Error(linkErr.message);

  for (const link of links || []) {
    const uid = link.user_id ? String(link.user_id) : '';
    if (uid && memberIds.has(uid) && gestorIds.has(uid)) return uid;
  }

  const { data: byPrimarySector, error: userErr } = await db
    .from('users')
    .select('id')
    .eq('sector_id', sectorId)
    .eq('is_active', true);
  if (userErr) throw new Error(userErr.message);

  for (const user of byPrimarySector || []) {
    const uid = user.id ? String(user.id) : '';
    if (uid && memberIds.has(uid) && gestorIds.has(uid)) return uid;
  }

  return null;
}

export async function resolveGestorUserIdForSectorName(
  db: SupabaseClient,
  workspaceId: string,
  sectorName: string
): Promise<string | null> {
  const sectorId = await resolveSectorIdByName(db, workspaceId, sectorName);
  if (!sectorId) return null;
  return resolveGestorUserIdForSectorId(db, workspaceId, sectorId);
}

export async function resolveGestorUserIdForConversation(
  db: SupabaseClient,
  workspaceId: string,
  conversationId: string,
  fallbackSectorName = MACRO_SECTOR_NAMES[0]
): Promise<string | null> {
  const { data: conv, error } = await db
    .from('conversations')
    .select('sector_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const sectorId = conv?.sector_id ? String(conv.sector_id) : null;
  if (sectorId) {
    const gestorId = await resolveGestorUserIdForSectorId(db, workspaceId, sectorId);
    if (gestorId) return gestorId;
  }

  return resolveGestorUserIdForSectorName(db, workspaceId, fallbackSectorName);
}

/** Gestor financeiro do workspace (SLA de adiantamento, revisões financeiras). */
export async function resolveFinanceGestorUserId(
  db: SupabaseClient,
  workspaceId: string
): Promise<string | null> {
  return resolveGestorUserIdForSectorName(db, workspaceId, MACRO_SECTOR_NAMES[2]);
}

/** Gestor operacional do workspace. */
export async function resolveOperacionalGestorUserId(
  db: SupabaseClient,
  workspaceId: string
): Promise<string | null> {
  return resolveGestorUserIdForSectorName(db, workspaceId, MACRO_SECTOR_NAMES[0]);
}
