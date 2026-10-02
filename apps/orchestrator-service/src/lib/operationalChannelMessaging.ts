import {
  buildChannelOutOfHoursText,
  channelConfigToBusinessHours,
  getChannelById,
  isChannelOpenNow,
  parseChannelMessagesFromRaw,
  resolveChannelMessageText,
} from '@plataforma/channel-runtime';
import type { SupabaseClient } from '@supabase/supabase-js';
import { shouldSuppressOutOfHoursForConversation } from './outOfHoursHumanGuards';
import { postWhatsAppMessage } from './whatsappOutbound';
import {
  formatNextOpenHuman,
  hasCanonicalBusinessHours,
  isOpen,
  nextOpenAt,
  normalizeBusinessHours,
} from './businessHours';
import { runtimeCatalogMessage } from '../workspaceCatalogRuntime';

const QUEUE_NOTICE_TAG = 'queue_waiting_notified';

async function isLegacyOohRuleDisabled(db: SupabaseClient, workspaceId: string): Promise<boolean> {
  const { data } = await db
    .from('workspace_out_of_hours_rules')
    .select('is_active')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  return data?.is_active === false;
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

async function loadConversationContext(
  db: SupabaseClient,
  conversationId: string,
): Promise<{
  workspaceId: string | null;
  workspaceChannelId: string | null;
  sectorId: string | null;
  attendantId: string | null;
  tags: string[];
  waPhone: string | null;
} | null> {
  const { data: conv } = await db
    .from('conversations')
    .select('workspace_id, workspace_channel_id, sector_id, attendant_id, tags, contacts(wa_phone)')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conv) return null;

  const contact = conv.contacts as { wa_phone?: string } | { wa_phone?: string }[] | null;
  const waPhone = Array.isArray(contact)
    ? contact[0]?.wa_phone
    : contact?.wa_phone;

  return {
    workspaceId: conv.workspace_id ? String(conv.workspace_id) : null,
    workspaceChannelId: conv.workspace_channel_id ? String(conv.workspace_channel_id) : null,
    sectorId: conv.sector_id ? String(conv.sector_id) : null,
    attendantId: conv.attendant_id ? String(conv.attendant_id) : null,
    tags: ((conv.tags || []) as string[]).filter(Boolean),
    waPhone: waPhone ? String(waPhone) : null,
  };
}

async function isSectorClosedNowLocal(
  db: SupabaseClient,
  sectorId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { data: sector } = await db.from('sectors').select('business_hours').eq('id', sectorId).single();
  const raw = sector?.business_hours;
  if (!hasCanonicalBusinessHours(raw)) return false;
  return !isOpen(normalizeBusinessHours(raw), now);
}

async function isClosedForOperationalChannel(args: {
  db: SupabaseClient;
  channelConfig: Record<string, unknown>;
  sectorId: string | null;
  channelOnly?: boolean;
  now?: Date;
}): Promise<boolean> {
  const now = args.now ?? new Date();
  if (channelConfigToBusinessHours(args.channelConfig)) {
    return !isChannelOpenNow(args.channelConfig, now);
  }
  if (args.channelOnly) return false;
  if (args.sectorId) return isSectorClosedNowLocal(args.db, args.sectorId, now);
  return false;
}

async function persistAutoReply(
  db: SupabaseClient,
  args: {
    workspaceId: string;
    conversationId: string;
    waPhone: string;
    text: string;
    extraTags?: string[];
    existingTags?: string[];
  },
): Promise<void> {
  await postWhatsAppMessage(
    db,
    {
      messaging_product: 'whatsapp',
      to: args.waPhone,
      type: 'text',
      text: { body: args.text },
    },
    args.workspaceId,
  );

  await db.from('messages').insert({
    workspace_id: args.workspaceId,
    conversation_id: args.conversationId,
    meta_message_id: null,
    direction: 'outbound',
    type: 'auto_reply',
    content: args.text,
    status: 'sent',
    sent_at: new Date().toISOString(),
  });

  const nextTags = Array.from(new Set([...(args.existingTags || []), ...(args.extraTags || [])]));
  await db
    .from('conversations')
    .update({
      tags: nextTags,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId);
}

/**
 * OOH operacional: prioriza motor do canal (`config.business_hours` + `config.messages.out_of_hours`).
 * Fallback: horário do setor + catálogo legado.
 */
export async function tryOperationalOutOfHoursNotice(
  db: SupabaseClient,
  args: {
    conversationId: string;
    sectorId?: string | null;
    channelOnly?: boolean;
  },
): Promise<boolean> {
  const ctx = await loadConversationContext(db, args.conversationId);
  if (!ctx?.workspaceId || !ctx.waPhone || ctx.waPhone.startsWith('leader_')) return false;
  if (await shouldSuppressOutOfHoursForConversation(db, args.conversationId)) return false;
  if (ctx.tags.includes('out_of_hours')) return false;

  const sectorId = args.channelOnly ? null : (args.sectorId ?? ctx.sectorId);
  let channelConfig: Record<string, unknown> = {};

  if (ctx.workspaceChannelId) {
    const channel = await getChannelById(db, ctx.workspaceChannelId);
    if (channel?.config) channelConfig = asRecord(channel.config);
    const purpose = String(channelConfig.purpose || '').trim().toLowerCase();
    if (purpose === 'commercial') return false;
  }

  const closed = await isClosedForOperationalChannel({
    db,
    channelConfig,
    sectorId,
    channelOnly: args.channelOnly,
  });
  if (!closed) return false;

  const channelHasMotorHours = Boolean(channelConfigToBusinessHours(channelConfig));
  if (!channelHasMotorHours && ctx.workspaceId && (await isLegacyOohRuleDisabled(db, ctx.workspaceId))) {
    return false;
  }

  let text = '';
  if (channelConfigToBusinessHours(channelConfig)) {
    text = buildChannelOutOfHoursText(channelConfig);
  } else if (sectorId) {
    const { data: sector } = await db.from('sectors').select('business_hours').eq('id', sectorId).single();
    const cfg = normalizeBusinessHours(sector?.business_hours);
    const messages = parseChannelMessagesFromRaw(channelConfig.messages);
    const base = resolveChannelMessageText(messages, 'out_of_hours', {
      fallback: runtimeCatalogMessage(
        'out_of_hours',
        'Obrigado pelo contato. No momento estamos fora do horário de atendimento.',
      ),
    });
    const human = hasCanonicalBusinessHours(cfg) ? formatNextOpenHuman(cfg, nextOpenAt(cfg, new Date())) : '';
    text = base.replace(/\{\{\s*next_open_at\s*\}\}/g, human);
  } else {
    return false;
  }

  if (!text.trim()) return false;

  try {
    await persistAutoReply(db, {
      workspaceId: ctx.workspaceId,
      conversationId: args.conversationId,
      waPhone: ctx.waPhone,
      text,
      extraTags: ['out_of_hours'],
      existingTags: ctx.tags,
    });
    return true;
  } catch (err) {
    console.error('[operational-ooh]', args.conversationId, err);
    return false;
  }
}

/**
 * Aviso de fila (`queue_full` do motor do canal) quando o atendimento está no setor sem atendente.
 */
export async function tryOperationalQueueWaitingNotice(
  db: SupabaseClient,
  conversationId: string,
): Promise<boolean> {
  const ctx = await loadConversationContext(db, conversationId);
  if (!ctx?.workspaceId || !ctx.waPhone || ctx.waPhone.startsWith('leader_')) return false;
  if (ctx.attendantId) return false;
  if (!ctx.sectorId) return false;
  if (ctx.tags.includes(QUEUE_NOTICE_TAG)) return false;

  let channelConfig: Record<string, unknown> = {};
  if (ctx.workspaceChannelId) {
    const channel = await getChannelById(db, ctx.workspaceChannelId);
    if (channel?.config) channelConfig = asRecord(channel.config);
    const purpose = String(channelConfig.purpose || '').trim().toLowerCase();
    if (purpose === 'commercial') return false;
  }

  const closed = await isClosedForOperationalChannel({
    db,
    channelConfig,
    sectorId: ctx.sectorId,
  });
  if (closed) return false;

  const messages = parseChannelMessagesFromRaw(channelConfig.messages);
  const text = resolveChannelMessageText(messages, 'queue_full', {
    fallback: runtimeCatalogMessage(
      'queue_full',
      'Você está na fila de atendimento. Em breve um consultor responde.',
    ),
  }).trim();
  if (!text) return false;

  const { data: recent } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('direction', 'outbound')
    .eq('content', text)
    .gte('created_at', new Date(Date.now() - 24 * 3_600_000).toISOString())
    .limit(1)
    .maybeSingle();
  if (recent?.id) return false;

  try {
    await persistAutoReply(db, {
      workspaceId: ctx.workspaceId,
      conversationId,
      waPhone: ctx.waPhone,
      text,
      extraTags: [QUEUE_NOTICE_TAG],
      existingTags: ctx.tags,
    });
    return true;
  } catch (err) {
    console.error('[operational-queue]', conversationId, err);
    return false;
  }
}

/** Primeiro contato inbound: OOH pelo horário do canal (antes da triagem). */
export async function tryOperationalOutOfHoursOnInbound(
  db: SupabaseClient,
  conversationId: string,
): Promise<boolean> {
  return tryOperationalOutOfHoursNotice(db, { conversationId, channelOnly: true });
}
