import {
  getChannelById,
  resolveChannelMessageText,
  sendWhatsAppTextViaChannel,
  type ChannelMessagesConfig,
} from '@plataforma/channel-runtime';
import { isOpen, normalizeBusinessHours } from './lib/businessHours';
import { runtimeCatalogMessage } from './workspaceCatalogRuntime';
import { supabase } from './lib/orchestratorContext';
import { scheduleCommercialLeadScoring } from '@plataforma/ai-core';

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

export async function resolveChannelPurpose(
  workspaceId: string,
  workspaceChannelId?: string | null
): Promise<'commercial' | 'operational'> {
  const channelId = String(workspaceChannelId || '').trim();
  if (!channelId) return 'operational';
  const channel = await getChannelById(supabase, channelId);
  if (!channel || channel.workspace_id !== workspaceId) return 'operational';
  const purpose = String(channel.config?.purpose || '').trim().toLowerCase();
  return purpose === 'commercial' ? 'commercial' : 'operational';
}

async function persistCommercialOutbound(args: {
  conversationId: string;
  workspaceId: string;
  content: string;
  metaMessageId?: string;
}) {
  await supabase.from('messages').insert({
    workspace_id: args.workspaceId,
    conversation_id: args.conversationId,
    meta_message_id: args.metaMessageId || null,
    direction: 'outbound',
    type: 'text',
    content: args.content,
    status: 'sent',
    sent_at: new Date().toISOString(),
  });
  await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', args.conversationId);

  const { data: conv } = await supabase
    .from('conversations')
    .select('context_commercial_lead_id, workspace_id')
    .eq('id', args.conversationId)
    .maybeSingle();
  const leadId = conv?.context_commercial_lead_id ? String(conv.context_commercial_lead_id) : null;
  if (leadId && conv?.workspace_id) {
    scheduleCommercialLeadScoring(supabase, {
      workspaceId: String(conv.workspace_id),
      leadId,
      reason: 'message_received',
    });
  }
}

async function sendCommercialText(args: {
  workspaceId: string;
  workspaceChannelId: string;
  conversationId: string;
  waPhone: string;
  text: string;
}) {
  const channel = await getChannelById(supabase, args.workspaceChannelId);
  if (!channel) throw new Error('Canal comercial não encontrado.');
  await sendWhatsAppTextViaChannel(channel, args.waPhone, args.text);
  await persistCommercialOutbound({
    conversationId: args.conversationId,
    workspaceId: args.workspaceId,
    content: args.text,
  });
}

function channelMessage(
  config: Record<string, unknown>,
  messageKey: keyof ChannelMessagesConfig | 'out_of_hours' | 'queue_full' | 'greeting',
  fallback: string
) {
  const messages = asRecord(config.messages);
  const merged = {
    greeting: String(messages.greeting || ''),
    out_of_hours: String(messages.out_of_hours || ''),
    queue_full: String(messages.queue_full || ''),
    closing: String(messages.closing || ''),
    csat: String(messages.csat || ''),
    intake: asRecord(messages.intake),
  };
  return resolveChannelMessageText(merged as ChannelMessagesConfig, String(messageKey), { fallback });
}

async function loadFreshCommercialSession(sessionId: string): Promise<{
  current_step: string;
  context_data: Record<string, unknown>;
}> {
  const { data } = await supabase
    .from('bot_sessions')
    .select('current_step, context_data')
    .eq('id', sessionId)
    .maybeSingle();
  return {
    current_step: String(data?.current_step || ''),
    context_data: asRecord(data?.context_data),
  };
}

async function hasRecentOutboundText(
  conversationId: string,
  text: string,
  withinMs = 24 * 3_600_000
): Promise<boolean> {
  const since = new Date(Date.now() - withinMs).toISOString();
  const { data } = await supabase
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('direction', 'outbound')
    .eq('content', text)
    .gte('created_at', since)
    .limit(1)
    .maybeSingle();
  return Boolean(data?.id);
}

async function updateCommercialSession(
  sessionId: string,
  contextData: Record<string, unknown>
) {
  const { data } = await supabase.from('bot_sessions').select('context_data').eq('id', sessionId).maybeSingle();
  const prev = asRecord(data?.context_data);
  await supabase
    .from('bot_sessions')
    .update({
      current_step: 'commercial_handoff',
      context_data: {
        ...prev,
        ...contextData,
        commercial_handoff: true,
        guided_intake: { completed: true },
      },
      expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    })
    .eq('id', sessionId);
}

function commercialSessionAlreadyHandled(ctx: Record<string, unknown>, currentStep: string): boolean {
  if (ctx.commercial_handoff || currentStep === 'commercial_handoff') return true;
  if (ctx.commercial_ooh_sent || ctx.commercial_greeting_sent) return true;
  return false;
}

/**
 * Bot mínimo do canal comercial: saudação + fila humana, sem funil operacional (entregador/setores).
 */
export async function tryProcessCommercialBotTurn(input: {
  workspaceId: string;
  workspaceChannelId: string;
  conversationId: string;
  contactWa: string;
  session: Record<string, unknown>;
}): Promise<boolean> {
  const purpose = await resolveChannelPurpose(input.workspaceId, input.workspaceChannelId);
  if (purpose !== 'commercial') return false;

  const sessionId = String(input.session.id || '').trim();
  if (!sessionId) return true;

  const fresh = await loadFreshCommercialSession(sessionId);
  const ctx = fresh.context_data;
  if (commercialSessionAlreadyHandled(ctx, fresh.current_step)) {
    return true;
  }

  const channel = await getChannelById(supabase, input.workspaceChannelId);
  if (!channel) return true;

  const businessHours = normalizeBusinessHours(channel.config?.business_hours ?? {});
  const now = new Date();
  if (!isOpen(businessHours, now)) {
    const text = channelMessage(
      channel.config,
      'out_of_hours',
      runtimeCatalogMessage(
        'out_of_hours',
        'Obrigado pela mensagem. Nosso comercial atende em horário útil e retornará em breve.'
      )
    );
    if (await hasRecentOutboundText(input.conversationId, text)) {
      await updateCommercialSession(sessionId, { commercial_ooh_sent: true });
      return true;
    }
    await sendCommercialText({
      workspaceId: input.workspaceId,
      workspaceChannelId: input.workspaceChannelId,
      conversationId: input.conversationId,
      waPhone: input.contactWa,
      text,
    });
    await updateCommercialSession(sessionId, { commercial_ooh_sent: true });
    return true;
  }

  const greeting = channelMessage(
    channel.config,
    'greeting',
    runtimeCatalogMessage('greeting', 'Olá! Aqui é o time comercial da Flux Farma. Como podemos ajudar?')
  );
  const queue = channelMessage(
    channel.config,
    'queue_full',
    runtimeCatalogMessage('queue_full', 'Aguarde um instante — em breve um consultor responde.')
  );
  const text = queue.trim() ? `${greeting}\n\n${queue}` : greeting;

  if (await hasRecentOutboundText(input.conversationId, text)) {
    await updateCommercialSession(sessionId, { commercial_greeting_sent: true });
    return true;
  }

  await sendCommercialText({
    workspaceId: input.workspaceId,
    workspaceChannelId: input.workspaceChannelId,
    conversationId: input.conversationId,
    waPhone: input.contactWa,
    text,
  });
  await updateCommercialSession(sessionId, { commercial_greeting_sent: true });
  return true;
}
