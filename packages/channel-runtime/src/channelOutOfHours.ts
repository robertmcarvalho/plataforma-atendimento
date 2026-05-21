import {
  applyMessageReplacements,
  parseChannelMessagesFromRaw,
  resolveChannelMessageText,
} from './channelMessages';
import {
  formatNextOpenHuman,
  hasCanonicalBusinessHours,
  isOpen,
  nextOpenAt,
  normalizeBusinessHours,
  type BusinessHoursConfig,
} from './businessHours';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ResolvedChannel } from './resolver';
import { resolveWhatsAppChannel } from './resolver';

export function channelConfigToBusinessHours(channelConfig: Record<string, unknown>): BusinessHoursConfig | null {
  const rawBh = channelConfig.business_hours;
  if (!hasCanonicalBusinessHours(rawBh)) return null;
  const base = normalizeBusinessHours(rawBh);
  const holidayStrings = Array.isArray(channelConfig.holidays)
    ? (channelConfig.holidays as unknown[]).map(String).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    : [];
  const holidays = [...base.holidays];
  for (const date of holidayStrings) {
    if (!holidays.some((h) => h.date === date)) {
      holidays.push({ date, is_open: false, intervals: [] });
    }
  }
  return { ...base, holidays };
}

export function isEdgeOutOfHoursReplyEnabled(channelConfig: Record<string, unknown>): boolean {
  const op = channelConfig.operation;
  if (op && typeof op === 'object' && (op as Record<string, unknown>).ooh_reply_at_edge === false) {
    return false;
  }
  return channelConfigToBusinessHours(channelConfig) !== null;
}

export function isChannelOpenNow(channelConfig: Record<string, unknown>, now: Date = new Date()): boolean {
  const bh = channelConfigToBusinessHours(channelConfig);
  if (!bh) return true;
  return isOpen(bh, now);
}

export function buildChannelOutOfHoursText(channelConfig: Record<string, unknown>, now: Date = new Date()): string {
  const messages = parseChannelMessagesFromRaw(channelConfig.messages);
  const bh = channelConfigToBusinessHours(channelConfig);
  const next = bh ? nextOpenAt(bh, now) : now;
  const human = bh ? formatNextOpenHuman(bh, next) : '';
  const base = resolveChannelMessageText(messages, 'out_of_hours', {
    fallback: messages.out_of_hours,
  });
  return applyMessageReplacements(base, { next_open_at: human });
}

export async function sendWhatsAppTextViaChannel(
  channel: ResolvedChannel,
  toWaPhone: string,
  body: string
): Promise<void> {
  const token = String(channel.credentials.access_token || '').trim();
  const phoneNumberId = String(channel.external_id || channel.credentials.phone_number_id || '').trim();
  const to = String(toWaPhone || '').replace(/\D/g, '');
  if (!token || !phoneNumberId || !to || !body.trim()) {
    throw new Error('Canal WhatsApp incompleto para envio (token, phone_number_id ou destino).');
  }

  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: body.trim() },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Meta API ${res.status}: ${errText.slice(0, 240)}`);
  }
}

export type EdgeOutOfHoursResult =
  | { handled: false }
  | {
      handled: true;
      workspace_channel_id: string;
      message_preview: string;
    };

/** Resposta automática na borda (webhook) quando o canal está fora do horário. */
export async function tryEdgeOutOfHoursReply(args: {
  channel: ResolvedChannel;
  toWaPhone: string;
}): Promise<EdgeOutOfHoursResult> {
  const cfg = args.channel.config || {};
  if (!isEdgeOutOfHoursReplyEnabled(cfg)) return { handled: false };
  if (isChannelOpenNow(cfg)) return { handled: false };

  const text = buildChannelOutOfHoursText(cfg);
  await sendWhatsAppTextViaChannel(args.channel, args.toWaPhone, text);
  return {
    handled: true,
    workspace_channel_id: args.channel.id,
    message_preview: text.slice(0, 120),
  };
}

export async function tryWebhookEdgeOutOfHoursReply(args: {
  db: SupabaseClient;
  workspaceId: string;
  phoneNumberId: string;
  toWaPhone: string;
}): Promise<EdgeOutOfHoursResult> {
  const channel = await resolveWhatsAppChannel(args.db, args.workspaceId, args.phoneNumberId);
  if (!channel || channel.source !== 'workspace') return { handled: false };
  return tryEdgeOutOfHoursReply({ channel, toWaPhone: args.toWaPhone });
}
