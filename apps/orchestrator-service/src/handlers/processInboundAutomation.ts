import { scheduleInboundAiAnalysis } from '@plataforma/ai-core';
import { setOutboundPhoneNumberId, setOutboundWorkspaceId } from '../lib/whatsappOutbound';
import { supabase, orchestratorConsole as console } from '../lib/orchestratorContext';
import { LATENCY_TARGETS_MS } from '../lib/orchestratorConfig';
import { logDuration } from '../lib/orchestratorUtils';
import { processBotSession, extractContent } from '../legacyBotRuntime';
import { processInboundTicketing } from '../ticketing/classifier';
import { tryHandleAdvanceRejectionFollowup } from '../lib/advanceRejectionFollowup.js';
import { tryHandleCsatInbound } from './csatInbound';
import { enrichInboundMedia } from './enrichInboundMedia';
import type { InboundAutomationJob } from '../lib/publishInboundAutomation';

const INBOUND_CONTACT_SELECT =
  'id, workspace_id, wa_phone, display_name, profile_type, driver_id, pharmacy_id, leader_id';
const INBOUND_CONVERSATION_SELECT =
  'id, workspace_id, workspace_channel_id, status, attendant_id, sector_id, contact_id, priority, tags, demand_key, opened_at, last_message_at';

/**
 * Fase 2 — automação assíncrona (bot, CSAT, ticketing, IA).
 * Consumida da fila whatsapp.inbound.auto com ordering key = wa_phone.
 */
export async function processInboundAutomation(job: InboundAutomationJob): Promise<void> {
  const totalStartedAt = Date.now();
  const { workspace_id: workspaceId, payload: msg, persist, channel } = job;
  const metaMessageId = persist.meta_message_id;
  const latencyMeta = {
    workspace_id: workspaceId,
    meta_message_id: metaMessageId,
    automation_kind: job.automation_kind,
    conversation_id: persist.conversation_id,
  };

  const phoneNumberId = String((channel as { phone_number_id?: string } | null)?.phone_number_id || '').trim() || null;
  setOutboundWorkspaceId(workspaceId);
  setOutboundPhoneNumberId(phoneNumberId);

  try {
    if (job.automation_kind === 'csat') {
      const csatStartedAt = Date.now();
      await tryHandleCsatInbound({
        db: supabase,
        workspaceId,
        contactId: persist.contact_id,
        waFrom: persist.wa_phone,
        msg,
        metaMessageId,
        phoneNumberId,
      });
      logDuration('automation_csat', csatStartedAt, latencyMeta, LATENCY_TARGETS_MS.bot_reply_sent);
      return;
    }

    if (!persist.conversation_id) {
      console.warn('[Orchestrator] automation standard sem conversation_id', metaMessageId);
      return;
    }

    const mediaStartedAt = Date.now();
    await enrichInboundMedia(job).catch((err) =>
      console.error('[Orchestrator] enrichInboundMedia', metaMessageId, err)
    );
    logDuration('automation_inbound_media', mediaStartedAt, latencyMeta);

    const { data: contact } = await supabase
      .from('contacts')
      .select(INBOUND_CONTACT_SELECT)
      .eq('id', persist.contact_id)
      .maybeSingle();
    const { data: conversation } = await supabase
      .from('conversations')
      .select(INBOUND_CONVERSATION_SELECT)
      .eq('id', persist.conversation_id)
      .maybeSingle();
    if (!contact || !conversation) {
      console.warn('[Orchestrator] automation: contato/conversa não encontrados', metaMessageId);
      return;
    }

    const followupStartedAt = Date.now();
    const followupHandled = await tryHandleAdvanceRejectionFollowup(supabase, {
      workspaceId,
      conversationId: persist.conversation_id,
      inboundText: extractContent(msg),
    });
    logDuration('automation_advance_rejection', followupStartedAt, { ...latencyMeta, handled: followupHandled });

    const botStartedAt = Date.now();
    if (!followupHandled) {
      try {
        await processBotSession(contact, conversation, msg);
      } catch (err) {
        console.error('[Orchestrator] automation bot session falhou', metaMessageId, err);
      }
    }
    logDuration('automation_bot_session', botStartedAt, latencyMeta, LATENCY_TARGETS_MS.bot_reply_sent);

    void processInboundTicketing(supabase, {
      workspaceId,
      conversationId: persist.conversation_id,
      contactId: persist.contact_id,
      inboundText: extractContent(msg),
      messageId: persist.message_id || '',
      msg,
    }).catch((err) => console.error('[Orchestrator] ticketing async', persist.conversation_id, err));

    if (persist.message_id) {
      try {
        const { count } = await supabase
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('conversation_id', persist.conversation_id)
          .eq('direction', 'inbound');
        const { data: convAi } = await supabase
          .from('conversations')
          .select('ai_sentiment_last')
          .eq('id', persist.conversation_id)
          .maybeSingle();
        const isFirstInbound = (count ?? 0) === 1;
        const needsSentiment = !convAi?.ai_sentiment_last;
        if (isFirstInbound || needsSentiment) {
          scheduleInboundAiAnalysis(supabase, {
            conversationId: persist.conversation_id,
            messageId: persist.message_id,
            inboundText: extractContent(msg),
            tenantId: workspaceId,
            reason: isFirstInbound ? 'first_message' : 'sentiment_backfill',
          });
        }
      } catch (e) {
        console.error('[ai] automation schedule', persist.conversation_id, e);
      }
    }

    logDuration('automation_total', totalStartedAt, latencyMeta, LATENCY_TARGETS_MS.total_processing);
  } finally {
    setOutboundWorkspaceId(null);
    setOutboundPhoneNumberId(null);
  }
}
