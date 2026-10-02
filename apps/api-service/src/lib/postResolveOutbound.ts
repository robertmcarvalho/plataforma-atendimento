import type { SupabaseClient } from '@supabase/supabase-js';
import type { ResolvedChannel } from '@plataforma/channel-runtime';
import {
  CSAT_LIST_BUTTON_LABEL,
  CSAT_LIST_SECTION_TITLE,
  CSAT_SCORE_LIST_ROWS,
  sendWhatsAppListViaChannel,
  sendWhatsAppTextViaChannel,
} from '@plataforma/channel-runtime';

function metaEnabledForChannel(channel: ResolvedChannel): boolean {
  const token = String(channel.credentials.access_token || '').trim();
  const phoneNumberId = String(channel.external_id || channel.credentials.phone_number_id || '').trim();
  return Boolean(token && phoneNumberId);
}

/**
 * Envia texto outbound após resolução sem reabrir a conversa (preserva status resolved/closed).
 */
export async function sendPostResolveOutboundText(args: {
  client: SupabaseClient;
  workspaceId: string;
  conversationId: string;
  channel: ResolvedChannel;
  toWaPhone: string;
  text: string;
  type?: string;
}): Promise<void> {
  const body = args.text.trim();
  if (!body) return;

  const now = new Date().toISOString();
  let metaMessageId: string | null = null;

  if (metaEnabledForChannel(args.channel)) {
    await sendWhatsAppTextViaChannel(args.channel, args.toWaPhone, body);
  }

  await args.client.from('messages').insert({
    workspace_id: args.workspaceId,
    conversation_id: args.conversationId,
    meta_message_id: metaMessageId,
    direction: 'outbound',
    type: args.type || 'text',
    content: body,
    status: 'sent',
    sent_at: now,
  });

  await args.client
    .from('conversations')
    .update({
      last_message_at: now,
      has_unread: false,
      updated_at: now,
    })
    .eq('workspace_id', args.workspaceId)
    .eq('id', args.conversationId);
}

/** Lista interativa 1–5 para CSAT pós-atendimento (não altera status da conversa). */
export async function sendPostResolveCsatList(args: {
  client: SupabaseClient;
  workspaceId: string;
  conversationId: string;
  channel: ResolvedChannel;
  toWaPhone: string;
  promptText: string;
}): Promise<void> {
  const body = args.promptText.trim();
  if (!body) return;

  const now = new Date().toISOString();
  if (metaEnabledForChannel(args.channel)) {
    await sendWhatsAppListViaChannel(
      args.channel,
      args.toWaPhone,
      body,
      CSAT_LIST_BUTTON_LABEL,
      CSAT_LIST_SECTION_TITLE,
      CSAT_SCORE_LIST_ROWS
    );
  }

  await args.client.from('messages').insert({
    workspace_id: args.workspaceId,
    conversation_id: args.conversationId,
    meta_message_id: null,
    direction: 'outbound',
    type: 'interactive',
    content: `${body}\n\n[Menu CSAT 1–5]`,
    status: 'sent',
    sent_at: now,
  });

  await args.client
    .from('conversations')
    .update({
      last_message_at: now,
      has_unread: false,
      updated_at: now,
    })
    .eq('workspace_id', args.workspaceId)
    .eq('id', args.conversationId);
}
