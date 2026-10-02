import type { SupabaseClient } from '@supabase/supabase-js';

export type ConversationRecord = Record<string, unknown> & {
  id?: string;
  status?: string;
  contact_id?: string;
  workspace_id?: string;
};

const OPEN_STATUSES = ['open', 'pending'] as const;
const REOPEN_STATUSES = ['resolved', 'closed'] as const;

export async function findOpenConversationForContact(
  db: SupabaseClient,
  workspaceId: string,
  contactId: string,
): Promise<ConversationRecord | null> {
  const { data } = await db
    .from('conversations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .in('status', [...OPEN_STATUSES])
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ConversationRecord | null) ?? null;
}

export async function findReopenableConversationForContact(
  db: SupabaseClient,
  workspaceId: string,
  contactId: string,
): Promise<ConversationRecord | null> {
  const { data } = await db
    .from('conversations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .in('status', [...REOPEN_STATUSES])
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ConversationRecord | null) ?? null;
}

export async function mergeDuplicateOpenConversations(
  db: SupabaseClient,
  workspaceId: string,
  contactId: string,
  keepConversationId?: string,
): Promise<string | null> {
  const { data: rows } = await db
    .from('conversations')
    .select('id, last_message_at, created_at')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .in('status', [...OPEN_STATUSES])
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });

  const open = rows || [];
  if (open.length <= 1) return open[0]?.id ? String(open[0].id) : keepConversationId || null;

  const keepId =
    keepConversationId && open.some((r) => String(r.id) === keepConversationId)
      ? keepConversationId
      : String(open[0].id);
  const closeIds = open.map((r) => String(r.id)).filter((id) => id !== keepId);
  if (!closeIds.length) return keepId;

  const now = new Date().toISOString();
  await db
    .from('conversations')
    .update({
      status: 'resolved',
      close_reason: 'duplicate_merge_auto',
      resolved_at: now,
      updated_at: now,
    })
    .eq('workspace_id', workspaceId)
    .in('id', closeIds);

  return keepId;
}

export function isUniqueOpenConversationViolation(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  const message = String((error as { message?: string })?.message || '');
  return code === '23505' && /conversations_one_open_per_contact/i.test(message);
}
