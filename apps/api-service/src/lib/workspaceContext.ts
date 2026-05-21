import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type WorkspaceMembership = {
  workspace_id: string;
  workspace_slug: string;
  workspace_name: string;
  workspace_role: string;
  is_default: boolean;
  permissions: Record<string, unknown>;
};

export type JwtUser = {
  sub: string;
  email?: string;
  name?: string;
  role?: string;
  workspace_role?: string;
  platform_role?: string;
  workspace_id?: string | null;
  active_workspace_id?: string | null;
  sector_id?: string | null;
  sector_ids?: string[];
  permissions?: Record<string, unknown>;
  memberships?: WorkspaceMembership[];
};

type MembershipRow = {
  is_default?: boolean | null;
  workspace_id?: string | null;
  workspaces?: { id?: string; slug?: string; display_name?: string } | Array<{ id?: string; slug?: string; display_name?: string }> | null;
  roles?: { name?: string; permissions?: Record<string, unknown> } | Array<{ name?: string; permissions?: Record<string, unknown> }> | null;
};

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function getDefaultWorkspace(db: SupabaseClient = supabase): Promise<{
  id: string;
  slug: string;
  display_name: string;
} | null> {
  const { data, error } = await db.from('workspaces').select('id, slug, display_name').order('created_at').limit(1).maybeSingle();
  if (error) {
    if ((error.message || '').includes('workspaces')) return null;
    throw new Error(error.message);
  }
  if (!data?.id) return null;
  const { data: setting } = await db
    .from('app_settings')
    .select('value')
    .eq('workspace_id', data.id)
    .eq('key', 'workspace_display_name')
    .maybeSingle();
  const configuredName = typeof setting?.value === 'string' ? setting.value.trim() : '';
  return {
    id: String(data.id),
    slug: String(data.slug || 'default'),
    display_name: configuredName || String(data.display_name || 'Workspace'),
  };
}

export async function listWorkspaceMemberships(userId: string, db: SupabaseClient = supabase): Promise<WorkspaceMembership[]> {
  const { data, error } = await db
    .from('workspace_memberships')
    .select('workspace_id, is_default, workspaces(id, slug, display_name), roles(name, permissions)')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('is_default', { ascending: false });

  if (error) {
    if ((error.message || '').includes('workspace_memberships')) return [];
    throw new Error(error.message);
  }

  return (data || [])
    .map((row) => {
      const item = row as MembershipRow;
      const workspace = unwrapOne(item.workspaces);
      const role = unwrapOne(item.roles);
      const workspaceId = String(item.workspace_id || workspace?.id || '').trim();
      if (!workspaceId) return null;
      return {
        workspace_id: workspaceId,
        workspace_slug: String(workspace?.slug || 'default'),
        workspace_name: String(workspace?.display_name || 'Workspace'),
        workspace_role: String(role?.name || 'attendant'),
        is_default: Boolean(item.is_default),
        permissions: (role?.permissions as Record<string, unknown>) || {},
      } satisfies WorkspaceMembership;
    })
    .filter((row): row is WorkspaceMembership => Boolean(row));
}

export async function getWorkspaceMembership(
  workspaceId: string,
  userId: string,
  db: SupabaseClient = supabase
): Promise<WorkspaceMembership | null> {
  const items = await listWorkspaceMemberships(userId, db);
  return items.find((item) => item.workspace_id === workspaceId) || null;
}

export async function upsertWorkspaceMembership(
  input: {
    workspace_id: string;
    user_id: string;
    role_id?: string | null;
    is_active?: boolean;
    is_default?: boolean;
  },
  db: SupabaseClient = supabase
) {
  const { error } = await db
    .from('workspace_memberships')
    .upsert(
      {
        workspace_id: input.workspace_id,
        user_id: input.user_id,
        role_id: input.role_id ?? null,
        is_active: input.is_active ?? true,
        is_default: input.is_default ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,user_id' }
    );

  if (error) throw new Error(error.message);

  if (input.is_default) {
    const { error: flipError } = await db
      .from('workspace_memberships')
      .update({ is_default: false, updated_at: new Date().toISOString() })
      .eq('user_id', input.user_id)
      .neq('workspace_id', input.workspace_id)
      .eq('is_default', true);
    if (flipError) throw new Error(flipError.message);
  }
}

export function resolveActiveWorkspaceId(user: Partial<JwtUser> | null | undefined, requestedWorkspaceId?: string | null) {
  const memberships = user?.memberships || [];
  const requested = String(requestedWorkspaceId || '').trim();
  if (requested && memberships.some((item) => item.workspace_id === requested)) return requested;
  if (user?.workspace_id) return user.workspace_id;
  return memberships.find((item) => item.is_default)?.workspace_id || memberships[0]?.workspace_id || null;
}

export function resolveActiveMembership(user: Partial<JwtUser> | null | undefined, requestedWorkspaceId?: string | null) {
  const workspaceId = resolveActiveWorkspaceId(user, requestedWorkspaceId);
  if (!workspaceId) return null;
  return (user?.memberships || []).find((item) => item.workspace_id === workspaceId) || null;
}

export function getWorkspaceIdFromRequest(request: FastifyRequest): string | null {
  const jwtUser = request.user as JwtUser | undefined;
  const headerValue = request.headers['x-workspace-id'];
  const requested = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  return resolveActiveWorkspaceId(jwtUser, typeof requested === 'string' ? requested : null);
}

export async function requireWorkspace(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const workspaceId = getWorkspaceIdFromRequest(request);
  if (!workspaceId) {
    await reply.status(412).send({ error: 'Workspace ativo não resolvido para esta sessão.' });
    return null;
  }
  return workspaceId;
}

type DbClient = Pick<SupabaseClient, 'from'>;
type RecordPayload = Record<string, unknown>;

export function scopedQuery(db: DbClient, table: string, workspaceId: string) {
  assertWorkspaceId(workspaceId);
  return db.from(table).select('*').eq('workspace_id', workspaceId);
}

export function scopedSelect(db: DbClient, table: string, workspaceId: string, columns = '*') {
  assertWorkspaceId(workspaceId);
  return db.from(table).select(columns).eq('workspace_id', workspaceId);
}

export function scopedInsert<T extends RecordPayload | RecordPayload[]>(db: DbClient, table: string, workspaceId: string, payload: T) {
  assertWorkspaceId(workspaceId);
  const attach = (row: RecordPayload) => ({ ...row, workspace_id: workspaceId });
  const rows = Array.isArray(payload) ? payload.map(attach) : attach(payload);
  return db.from(table).insert(rows);
}

export function scopedUpdate(db: DbClient, table: string, workspaceId: string, id: string, updates: RecordPayload) {
  assertWorkspaceId(workspaceId);
  assertEntityId(id);
  return db.from(table).update(updates).eq('workspace_id', workspaceId).eq('id', id);
}

export function scopedDelete(db: DbClient, table: string, workspaceId: string, id: string) {
  assertWorkspaceId(workspaceId);
  assertEntityId(id);
  return db.from(table).delete().eq('workspace_id', workspaceId).eq('id', id);
}

function assertWorkspaceId(workspaceId: string) {
  if (!workspaceId || !/^[0-9a-f-]{36}$/i.test(workspaceId)) {
    throw new Error('WORKSPACE_SCOPE_ERROR: workspace_id inválido ou ausente.');
  }
}

function assertEntityId(id: string) {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw new Error('WORKSPACE_SCOPE_ERROR: id inválido ou ausente.');
  }
}

export function hasPlatformAccess(user: JwtUser | null | undefined) {
  const role = String(user?.platform_role || '').trim().toLowerCase();
  return role === 'platform_admin' || role === 'platform_owner';
}
