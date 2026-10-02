import type { SupabaseClient } from '@supabase/supabase-js';

const cache = new Map<string, string | null>();

function envAuthorId(): string | null {
  const id =
    process.env.SYSTEM_NOTE_AUTHOR_ID?.trim() ||
    process.env.ORCHESTRATOR_INTERNAL_NOTE_AUTHOR_ID?.trim() ||
    process.env.API_INTERNAL_NOTE_AUTHOR_ID?.trim();
  return id || null;
}

/**
 * Autor único para notas automáticas (SLA, bot, scheduler).
 * Ordem: env → usuário "Sistema" no workspace → usuário "Sistema" global.
 */
export async function resolveSystemNoteAuthorId(
  db: SupabaseClient,
  workspaceId: string,
): Promise<string | null> {
  const fromEnv = envAuthorId();
  if (fromEnv) return fromEnv;

  const cacheKey = workspaceId || '__global__';
  if (cache.has(cacheKey)) return cache.get(cacheKey) ?? null;

  if (workspaceId) {
    const { data: members } = await db
      .from('workspace_memberships')
      .select('user_id, users!inner(id, name, is_active)')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true);

    for (const row of members || []) {
      const user = row.users as { id?: string; name?: string; is_active?: boolean } | { id?: string; name?: string; is_active?: boolean }[];
      const u = Array.isArray(user) ? user[0] : user;
      if (!u?.id || u.is_active === false) continue;
      if (String(u.name || '').trim().toLowerCase() === 'sistema') {
        const id = String(u.id);
        cache.set(cacheKey, id);
        return id;
      }
    }

    const sysEmail = `sistema+${workspaceId}@flux-farma.internal`;
    const { data: byEmail } = await db
      .from('users')
      .select('id')
      .eq('email', sysEmail)
      .eq('is_active', true)
      .maybeSingle();
    if (byEmail?.id) {
      const id = String(byEmail.id);
      cache.set(cacheKey, id);
      return id;
    }
  }

  const { data: globalSys } = await db
    .from('users')
    .select('id, name')
    .eq('is_active', true)
    .ilike('name', 'sistema')
    .limit(5);
  const hit = (globalSys || []).find((r) => String(r.name || '').trim().toLowerCase() === 'sistema');
  const id = hit?.id ? String(hit.id) : null;
  cache.set(cacheKey, id);
  return id;
}

export async function insertSystemInternalNote(
  db: SupabaseClient,
  args: { workspaceId: string; conversationId: string; content: string },
): Promise<boolean> {
  const authorId = await resolveSystemNoteAuthorId(db, args.workspaceId);
  if (!authorId) return false;
  const { error } = await db.from('internal_notes').insert({
    workspace_id: args.workspaceId,
    conversation_id: args.conversationId,
    author_id: authorId,
    content: args.content,
  });
  return !error;
}
