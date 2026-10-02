import { supabase } from './supabase';
import {
  buildWebhookCallbackUrl,
  getChannelById,
  resolveWhatsAppChannel,
  type ResolvedChannel,
} from '@plataforma/channel-runtime';

export type { ResolvedChannel };

export async function getWorkspaceWhatsAppChannel(
  workspaceId: string,
  phoneNumberId?: string | null
): Promise<ResolvedChannel | null> {
  return resolveWhatsAppChannel(supabase, workspaceId, phoneNumberId);
}

export async function getWorkspaceChannelById(channelId: string): Promise<ResolvedChannel | null> {
  return getChannelById(supabase, channelId);
}

export type WhatsAppSendConfig = {
  phone_number_id: string;
  access_token: string;
};

export function whatsAppSendConfigFromChannel(channel: ResolvedChannel | null): WhatsAppSendConfig | null {
  const phone_number_id = String(channel?.external_id || channel?.credentials?.phone_number_id || '').trim();
  const access_token = String(channel?.credentials?.access_token || process.env.META_ACCESS_TOKEN || '').trim();
  if (!phone_number_id || !access_token) return null;
  return { phone_number_id, access_token };
}

export async function resolveWhatsAppSendConfig(
  workspaceId: string,
  workspaceChannelId?: string | null
): Promise<WhatsAppSendConfig | null> {
  const channelId = String(workspaceChannelId || '').trim();
  if (channelId) {
    const byId = await getWorkspaceChannelById(channelId);
    const cfg = whatsAppSendConfigFromChannel(byId);
    if (cfg) return cfg;
  }
  const fallback = await getWorkspaceWhatsAppChannel(workspaceId);
  return whatsAppSendConfigFromChannel(fallback);
}

export async function sendWhatsAppCloudMessage(
  payload: object,
  config: WhatsAppSendConfig
): Promise<{ messages?: Array<{ id?: string }> }> {
  const version = process.env.META_GRAPH_VERSION?.trim() || 'v19.0';
  const response = await fetch(`https://graph.facebook.com/${version}/${config.phone_number_id}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw { status: response.status, detail };
  }
  return response.json() as Promise<{ messages?: Array<{ id?: string }> }>;
}

export { buildWebhookCallbackUrl };
