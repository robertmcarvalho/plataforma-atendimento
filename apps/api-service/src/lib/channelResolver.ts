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

export { buildWebhookCallbackUrl };
