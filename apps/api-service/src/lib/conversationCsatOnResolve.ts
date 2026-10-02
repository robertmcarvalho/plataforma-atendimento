import type { SupabaseClient } from '@supabase/supabase-js';
import {
  hasCsatSentThisMonthForSector,
  parseChannelMessagesFromRaw,
  type ResolvedChannel,
} from '@plataforma/channel-runtime';
import { getWorkspaceChannelById, getWorkspaceWhatsAppChannel } from './channelResolver';
import { sendPostResolveCsatList, sendPostResolveOutboundText } from './postResolveOutbound';
import {
  resolveClosingTextForPostResolve,
  shouldSkipClosingAfterAttendantReply,
} from './postResolveClosingPolicy';

export {
  RECENT_ATTENDANT_REPLY_SKIP_CLOSING_MS,
  resolveClosingTextForPostResolve,
  shouldSkipClosingAfterAttendantReply,
} from './postResolveClosingPolicy';

export function isLeaderPortalConversation(conv: {
  sla_applied_from?: string | null;
  tags?: string[] | null;
}): boolean {
  if (conv.sla_applied_from === 'portal_lider') return true;
  return Array.isArray(conv.tags) && conv.tags.includes('portal-lider');
}

function isCsatEnabled(channelConfig: Record<string, unknown>): boolean {
  const op = channelConfig.operation;
  if (op && typeof op === 'object' && !Array.isArray(op)) {
    const enabled = (op as Record<string, unknown>).csat_enabled;
    if (enabled === false) return false;
  }
  return true;
}

function metaEnabledForChannel(channel: ResolvedChannel): boolean {
  const token = String(channel.credentials.access_token || '').trim();
  const phoneNumberId = String(channel.external_id || channel.credentials.phone_number_id || '').trim();
  return Boolean(token && phoneNumberId);
}

async function lastOutboundAt(
  client: SupabaseClient,
  workspaceId: string,
  conversationId: string
): Promise<string | null> {
  const { data } = await client
    .from('messages')
    .select('created_at')
    .eq('workspace_id', workspaceId)
    .eq('conversation_id', conversationId)
    .eq('direction', 'outbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.created_at ? String(data.created_at) : null;
}

async function lastInboundWithin24h(
  client: SupabaseClient,
  workspaceId: string,
  conversationId: string
): Promise<boolean> {
  const { data } = await client
    .from('messages')
    .select('created_at')
    .eq('workspace_id', workspaceId)
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.created_at) return false;
  return Date.now() - new Date(data.created_at).getTime() < 24 * 3600000;
}

async function resolveChannelForConversation(
  workspaceId: string,
  workspaceChannelId: string | null | undefined
): Promise<ResolvedChannel | null> {
  if (workspaceChannelId) {
    const byId = await getWorkspaceChannelById(workspaceChannelId);
    if (byId) return byId;
  }
  return getWorkspaceWhatsAppChannel(workspaceId);
}

function extractWaPhone(contacts: unknown): string | null {
  const contact = Array.isArray(contacts) ? contacts[0] : contacts;
  if (!contact || typeof contact !== 'object') return null;
  const phone = String((contact as { wa_phone?: string }).wa_phone || '').trim();
  return phone || null;
}

function extractContactId(contacts: unknown): string | null {
  const contact = Array.isArray(contacts) ? contacts[0] : contacts;
  if (!contact || typeof contact !== 'object') return null;
  const id = String((contact as { id?: string }).id || '').trim();
  return id || null;
}

/**
 * Dispara encerramento + CSAT (lista 1–5) ao resolver conversa.
 * CSAT: no máximo 1 envio por mês por contato + setor (setores diferentes podem receber de novo).
 */
export async function runCsatOnConversationResolved(
  client: SupabaseClient,
  conversationId: string,
  workspaceId: string
): Promise<void> {
  const { data: conv, error } = await client
    .from('conversations')
    .select(
      'id, workspace_id, workspace_channel_id, status, sector_id, attendant_id, sla_applied_from, tags, csat_sent_at, contacts(id, wa_phone)'
    )
    .eq('workspace_id', workspaceId)
    .eq('id', conversationId)
    .maybeSingle();

  if (error || !conv) return;
  if (isLeaderPortalConversation(conv)) return;
  if (conv.csat_sent_at) return;

  const waPhone = extractWaPhone(conv.contacts);
  const contactId = extractContactId(conv.contacts);
  if (!waPhone || waPhone.startsWith('leader_') || !contactId) return;

  const channel = await resolveChannelForConversation(workspaceId, conv.workspace_channel_id as string | null);
  if (!channel) {
    console.warn('[csat-on-resolve] canal WhatsApp não encontrado', conversationId);
    return;
  }

  const channelConfig = channel.config || {};
  const csatEnabled = isCsatEnabled(channelConfig);
  const messages = parseChannelMessagesFromRaw(channelConfig.messages);
  const closingText = resolveClosingTextForPostResolve(messages.closing);
  const csatText = messages.csat.trim() || 'De 1 a 5, como você avalia nosso atendimento?';

  const lastOutbound = await lastOutboundAt(client, workspaceId, conversationId);
  const skipClosing = shouldSkipClosingAfterAttendantReply({
    attendantId: conv.attendant_id as string | null,
    lastOutboundAt: lastOutbound,
  });

  const maybeSendClosing = async () => {
    if (!closingText || skipClosing) {
      if (skipClosing) {
        console.info('[csat-on-resolve] skip closing — atendente respondeu recentemente', conversationId);
      }
      return;
    }
    await sendPostResolveOutboundText({
      client,
      workspaceId,
      conversationId,
      channel,
      toWaPhone: waPhone,
      text: closingText,
    });
  };

  const metaEnabled = metaEnabledForChannel(channel);
  if (metaEnabled && csatEnabled) {
    const within24h = await lastInboundWithin24h(client, workspaceId, conversationId);
    if (!within24h) {
      console.info('[csat-on-resolve] skip CSAT fora da janela 24h', conversationId);
      await maybeSendClosing();
      return;
    }
  }

  const sectorId = conv.sector_id ? String(conv.sector_id) : null;
  const alreadySentThisMonth =
    csatEnabled &&
    (await hasCsatSentThisMonthForSector(client, workspaceId, contactId, sectorId));

  const sendArgs = {
    client,
    workspaceId,
    conversationId,
    channel,
    toWaPhone: waPhone,
  };

  if (closingText && !skipClosing) {
    await sendPostResolveOutboundText({ ...sendArgs, text: closingText });
  } else if (skipClosing) {
    console.info('[csat-on-resolve] skip closing — atendente respondeu recentemente', conversationId);
  }

  if (!csatEnabled || alreadySentThisMonth) {
    if (alreadySentThisMonth) {
      console.info('[csat-on-resolve] CSAT já enviado neste mês para contato/setor', {
        conversationId,
        contactId,
        sectorId,
      });
    }
    return;
  }

  await sendPostResolveCsatList({ ...sendArgs, promptText: csatText });

  const now = new Date().toISOString();
  await client.from('contact_csat_dispatches').insert({
    workspace_id: workspaceId,
    contact_id: contactId,
    sector_id: sectorId,
    conversation_id: conversationId,
    sent_at: now,
  });

  await client
    .from('conversations')
    .update({ csat_sent_at: now, updated_at: now })
    .eq('workspace_id', workspaceId)
    .eq('id', conversationId);
}

export function scheduleCsatOnConversationResolved(
  client: SupabaseClient,
  conversationId: string,
  workspaceId: string
): void {
  void runCsatOnConversationResolved(client, conversationId, workspaceId).catch((err) =>
    console.error('[csat-on-resolve-schedule]', conversationId, err)
  );
}
