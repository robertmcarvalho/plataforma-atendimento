import { extractInboundDisplayContent, isMediaMessageType, metaWebhookTimestampToIso } from '@plataforma/channel-runtime';
import { findPendingCsatDispatch } from '@plataforma/channel-runtime';
import { scheduleCommercialLeadScoring } from '@plataforma/ai-core';
import { setOutboundPhoneNumberId, setOutboundWorkspaceId } from '../lib/whatsappOutbound';
import { supabase, orchestratorConsole as console } from '../lib/orchestratorContext';
import { LATENCY_TARGETS_MS } from '../lib/orchestratorConfig';
import { logDuration } from '../lib/orchestratorUtils';
import {
  createConversation,
  ensureConversationSummary,
  extractContent,
  getActiveConversation,
  getOrCreateContact,
  getReopenableConversation,
} from '../legacyBotRuntime';
import { resolveInboundWorkspaceChannelId } from './inboundMessage';
import { enrichInboundMedia } from './enrichInboundMedia';
import { publishInboundAutomation, type InboundAutomationJob } from '../lib/publishInboundAutomation';

type InboundChannelEnvelope = {
  workspace_channel_id?: unknown;
  channel_type?: unknown;
  phone_number_id?: unknown;
};

export type PersistInboundResult =
  | { kind: 'duplicate' }
  | { kind: 'skipped' }
  | { kind: 'ok'; automation: InboundAutomationJob };

async function buildAutomationJob(
  args: Omit<InboundAutomationJob, 'type'>
): Promise<InboundAutomationJob> {
  return { type: 'inbound_automation', ...args };
}

async function republishIfMessageExists(
  metaMessageId: string,
  workspaceId: string,
  channel: InboundChannelEnvelope | null,
  msg: Record<string, unknown>,
  from: string
): Promise<PersistInboundResult> {
  const { data: existingMsg } = await supabase
    .from('messages')
    .select('id, conversation_id')
    .eq('meta_message_id', metaMessageId)
    .maybeSingle();
  if (!existingMsg?.id) return { kind: 'duplicate' };

  const { data: conv } = await supabase
    .from('conversations')
    .select('id, workspace_channel_id, contact_id, contact:contacts(wa_phone)')
    .eq('id', existingMsg.conversation_id)
    .maybeSingle();

  const contactRow = conv?.contact as { wa_phone?: string } | null;
  const waPhone = String(contactRow?.wa_phone || from || '');

  const automation = await buildAutomationJob({
    automation_kind: 'standard',
    workspace_id: workspaceId,
    channel: (channel as Record<string, unknown>) || null,
    payload: msg,
    persist: {
      contact_id: String(conv?.contact_id || ''),
      conversation_id: String(existingMsg.conversation_id),
      message_id: String(existingMsg.id),
      workspace_channel_id: conv?.workspace_channel_id ? String(conv.workspace_channel_id) : null,
      wa_phone: waPhone,
      meta_message_id: metaMessageId,
    },
  });
  await publishInboundAutomation(automation);
  return { kind: 'ok', automation };
}

/**
 * Fase 1 — persistência rápida (< 3s): contato, conversa, mensagem; enfileira automação.
 */
export async function persistInboundFast(
  msg: Record<string, unknown>,
  workspaceId: string | null,
  channel: InboundChannelEnvelope | null
): Promise<PersistInboundResult> {
  const totalStartedAt = Date.now();
  const metaMessageId = String((msg as { id?: string }).id || '').trim();
  const from = String(msg.from || '');
  const type = String(msg.type || 'text');
  const effectiveWorkspaceId = String(workspaceId || '').trim();
  const latencyMeta = {
    workspace_id: effectiveWorkspaceId || null,
    meta_message_id: metaMessageId || null,
    wa_from: from || null,
  };

  if (!metaMessageId || !effectiveWorkspaceId) {
    console.warn('[Orchestrator] persistInboundFast: meta_message_id ou workspace ausente');
    return { kind: 'skipped' };
  }

  const claimStartedAt = Date.now();
  const { error: claimErr } = await supabase.from('processed_webhook_events').insert({
    workspace_id: effectiveWorkspaceId,
    meta_message_id: metaMessageId,
    event_type: 'inbound_message',
  });
  logDuration('idempotency_claim', claimStartedAt, latencyMeta, LATENCY_TARGETS_MS.inbound_ack);

  if (claimErr) {
    const code = (claimErr as { code?: string }).code;
    const detail = String((claimErr as { message?: string }).message || '');
    const duplicate = code === '23505' || /duplicate key|unique constraint/i.test(detail);
    if (duplicate) {
      console.log(`Mensagem duplicada (persist): ${metaMessageId} — republicando automação se necessário`);
      const republished = await republishIfMessageExists(metaMessageId, effectiveWorkspaceId, channel, msg, from);
      if (republished.kind === 'duplicate') {
        console.warn('[Orchestrator] duplicate sem mensagem persistida — reprocessando persistência', metaMessageId);
        await supabase
          .from('processed_webhook_events')
          .delete()
          .eq('workspace_id', effectiveWorkspaceId)
          .eq('meta_message_id', metaMessageId);
        return persistInboundFast(msg, workspaceId, channel);
      }
      return republished;
    }
    throw claimErr;
  }

  const inboundPhoneNumberId = String(channel?.phone_number_id || '').trim() || null;
  setOutboundWorkspaceId(effectiveWorkspaceId);
  setOutboundPhoneNumberId(inboundPhoneNumberId);

  try {
    const workspaceChannelId = await resolveInboundWorkspaceChannelId(effectiveWorkspaceId, channel);
    const contact = await getOrCreateContact(from, msg, effectiveWorkspaceId);
    if (!contact?.id) throw new Error(`Falha ao resolver contato inbound ${metaMessageId}`);

    const waPhone = String(contact.wa_phone || from);
    const pendingCsat = await findPendingCsatDispatch(supabase, effectiveWorkspaceId, String(contact.id));
    if (pendingCsat) {
      const csatConversationId = pendingCsat.conversation_id ? String(pendingCsat.conversation_id) : null;
      const inboundSentAt = metaWebhookTimestampToIso(msg) || new Date().toISOString();
      let csatMessageRowId: string | null = null;
      if (csatConversationId) {
        const { data: insertedCsatMessage } = await supabase
          .from('messages')
          .insert({
            workspace_id: effectiveWorkspaceId,
            conversation_id: csatConversationId,
            meta_message_id: metaMessageId,
            direction: 'inbound',
            type,
            content: extractInboundDisplayContent(msg) || extractContent(msg),
            status: 'delivered',
            sent_at: inboundSentAt,
          })
          .select('id')
          .single();
        csatMessageRowId = String((insertedCsatMessage as { id?: string } | null)?.id || '') || null;
        await supabase
          .from('conversations')
          .update({
            last_message_at: inboundSentAt,
            has_unread: false,
            updated_at: new Date().toISOString(),
          })
          .eq('workspace_id', effectiveWorkspaceId)
          .eq('id', csatConversationId);
      }
      const automation = await buildAutomationJob({
        automation_kind: 'csat',
        workspace_id: effectiveWorkspaceId,
        channel: (channel as Record<string, unknown>) || null,
        payload: msg,
        persist: {
          contact_id: String(contact.id),
          conversation_id: csatConversationId,
          message_id: csatMessageRowId,
          workspace_channel_id: workspaceChannelId,
          wa_phone: waPhone,
          meta_message_id: metaMessageId,
        },
      });
      await publishInboundAutomation(automation);
      logDuration('persist_inbound_csat_enqueue', totalStartedAt, latencyMeta, LATENCY_TARGETS_MS.message_persisted);
      return { kind: 'ok', automation };
    }

    let conversation = await getActiveConversation(String(contact.id), effectiveWorkspaceId, workspaceChannelId);
    if (!conversation) {
      conversation = await getReopenableConversation(String(contact.id), effectiveWorkspaceId, workspaceChannelId);
    }
    if (!conversation) {
      conversation = await createConversation(contact, extractContent(msg), effectiveWorkspaceId, workspaceChannelId);
      if (!conversation?.id) throw new Error(`Falha ao criar conversa inbound ${metaMessageId}`);
    } else {
      await ensureConversationSummary(conversation.id as string, extractContent(msg));
      if (workspaceChannelId && !conversation.workspace_channel_id) {
        await supabase
          .from('conversations')
          .update({ workspace_channel_id: workspaceChannelId, updated_at: new Date().toISOString() })
          .eq('workspace_id', effectiveWorkspaceId)
          .eq('id', conversation.id);
        conversation = { ...conversation, workspace_channel_id: workspaceChannelId };
      }
      const commercialLeadId = contact.commercial_lead_id ? String(contact.commercial_lead_id) : null;
      if (commercialLeadId && !conversation.context_commercial_lead_id) {
        await supabase
          .from('conversations')
          .update({ context_commercial_lead_id: commercialLeadId, updated_at: new Date().toISOString() })
          .eq('id', conversation.id);
        conversation = { ...conversation, context_commercial_lead_id: commercialLeadId };
      }
    }

    const inboundSentAt = metaWebhookTimestampToIso(msg) || new Date().toISOString();
    const messageStartedAt = Date.now();
    const { data: insertedMessage } = await supabase
      .from('messages')
      .insert({
        workspace_id: effectiveWorkspaceId,
        conversation_id: conversation.id,
        meta_message_id: metaMessageId,
        direction: 'inbound',
        type,
        content: extractInboundDisplayContent(msg) || extractContent(msg),
        status: 'delivered',
        sent_at: inboundSentAt,
      })
      .select('id')
      .single();

    const wasTerminal =
      String(conversation.status || '') === 'resolved' || String(conversation.status || '') === 'closed';
    const reopenPatch: Record<string, unknown> = {
      last_message_at: inboundSentAt,
      status: 'open',
      resolved_at: null,
      close_reason: null,
      has_unread: true,
      updated_at: new Date().toISOString(),
    };
    if (wasTerminal) {
      reopenPatch.tags = [];
      reopenPatch.attendant_id = null;
    }

    await supabase
      .from('conversations')
      .update(reopenPatch)
      .eq('workspace_id', effectiveWorkspaceId)
      .eq('id', conversation.id);

    const commercialLeadId = String(
      conversation.context_commercial_lead_id || contact.commercial_lead_id || '',
    ).trim();
    if (commercialLeadId) {
      scheduleCommercialLeadScoring(supabase, {
        workspaceId: effectiveWorkspaceId,
        leadId: commercialLeadId,
        reason: 'message_received',
      });
    }

    logDuration('persist_inbound_message', messageStartedAt, {
      ...latencyMeta,
      conversation_id: String(conversation.id),
      message_row_id: String((insertedMessage as { id?: string } | null)?.id || '') || null,
    }, LATENCY_TARGETS_MS.message_persisted);

    const messageRowId = String((insertedMessage as { id?: string } | null)?.id || '') || null;
    if (messageRowId && isMediaMessageType(type)) {
      const mediaJob = await buildAutomationJob({
        automation_kind: 'standard',
        workspace_id: effectiveWorkspaceId,
        channel: (channel as Record<string, unknown>) || null,
        payload: msg,
        persist: {
          contact_id: String(contact.id),
          conversation_id: String(conversation.id),
          message_id: messageRowId,
          workspace_channel_id: workspaceChannelId,
          wa_phone: waPhone,
          meta_message_id: metaMessageId,
        },
      });
      const mediaStartedAt = Date.now();
      await enrichInboundMedia(mediaJob).catch((err) =>
        console.error('[Orchestrator] enrichInboundMedia (persist)', metaMessageId, err)
      );
      logDuration('persist_inbound_media', mediaStartedAt, {
        ...latencyMeta,
        conversation_id: String(conversation.id),
        message_row_id: messageRowId,
      });
    }

    const automation = await buildAutomationJob({
      automation_kind: 'standard',
      workspace_id: effectiveWorkspaceId,
      channel: (channel as Record<string, unknown>) || null,
      payload: msg,
      persist: {
        contact_id: String(contact.id),
        conversation_id: String(conversation.id),
        message_id: String((insertedMessage as { id?: string } | null)?.id || '') || null,
        workspace_channel_id: workspaceChannelId,
        wa_phone: waPhone,
        meta_message_id: metaMessageId,
      },
    });
    await publishInboundAutomation(automation);

    logDuration('persist_inbound_total', totalStartedAt, {
      ...latencyMeta,
      conversation_id: String(conversation.id),
    }, LATENCY_TARGETS_MS.message_persisted);

    return { kind: 'ok', automation };
  } finally {
    setOutboundWorkspaceId(null);
    setOutboundPhoneNumberId(null);
  }
}
