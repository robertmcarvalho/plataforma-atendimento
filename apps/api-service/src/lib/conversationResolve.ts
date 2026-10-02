import {
  findOpenConversationForContact,
  findReopenableConversationForContact,
  isUniqueOpenConversationViolation,
  mergeDuplicateOpenConversations,
} from '@plataforma/channel-runtime';
import type { SupabaseClient } from '@supabase/supabase-js';

export {
  findOpenConversationForContact,
  findReopenableConversationForContact,
  mergeDuplicateOpenConversations,
  isUniqueOpenConversationViolation,
};

export async function resolveOrReuseConversation(
  db: SupabaseClient,
  args: {
    workspaceId: string;
    contactId: string;
    insert: Record<string, unknown>;
    reopenPatch?: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  const open = await findOpenConversationForContact(db, args.workspaceId, args.contactId);
  if (open?.id) {
    const patch = { ...args.reopenPatch, updated_at: new Date().toISOString() };
    const { data, error } = await db
      .from('conversations')
      .update(patch)
      .eq('workspace_id', args.workspaceId)
      .eq('id', open.id)
      .select()
      .single();
    if (error) throw error;
    return data as Record<string, unknown>;
  }

  const reopenable = await findReopenableConversationForContact(db, args.workspaceId, args.contactId);
  if (reopenable?.id) {
    const patch = {
      status: 'open',
      resolved_at: null,
      close_reason: null,
      ...args.reopenPatch,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await db
      .from('conversations')
      .update(patch)
      .eq('workspace_id', args.workspaceId)
      .eq('id', reopenable.id)
      .select()
      .single();
    if (error) throw error;
    return data as Record<string, unknown>;
  }

  const ins = await db
    .from('conversations')
    .insert({ ...args.insert, workspace_id: args.workspaceId, contact_id: args.contactId, status: 'open' })
    .select()
    .single();

  if (ins.error && isUniqueOpenConversationViolation(ins.error)) {
    await mergeDuplicateOpenConversations(db, args.workspaceId, args.contactId);
    const again = await findOpenConversationForContact(db, args.workspaceId, args.contactId);
    if (again?.id) {
      const { data, error } = await db
        .from('conversations')
        .update({ ...args.reopenPatch, updated_at: new Date().toISOString() })
        .eq('id', again.id)
        .select()
        .single();
      if (error) throw error;
      return data as Record<string, unknown>;
    }
  }
  if (ins.error) throw ins.error;
  return ins.data as Record<string, unknown>;
}

export async function updatePrimaryConversationIfActive(
  db: SupabaseClient,
  workspaceId: string,
  leadId: string,
  conversationId: string,
  conversationStatus: string,
): Promise<void> {
  if (!['open', 'pending'].includes(conversationStatus)) {
    const { data: lead } = await db
      .from('commercial_leads')
      .select('primary_conversation_id')
      .eq('workspace_id', workspaceId)
      .eq('id', leadId)
      .maybeSingle();
    if (lead?.primary_conversation_id && String(lead.primary_conversation_id) !== conversationId) {
      return;
    }
  }
  await db
    .from('commercial_leads')
    .update({ primary_conversation_id: conversationId, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('id', leadId);
}
