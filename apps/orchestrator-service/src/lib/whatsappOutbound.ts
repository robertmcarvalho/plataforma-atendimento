import type { SupabaseClient } from '@supabase/supabase-js';
import axios from 'axios';
import { resolveWhatsAppChannel } from '@plataforma/channel-runtime';

let activeWorkspaceId: string | null = null;

export function setOutboundWorkspaceId(workspaceId: string | null): void {
  activeWorkspaceId = workspaceId ? String(workspaceId).trim() || null : null;
}

export async function postWhatsAppMessage(
  db: SupabaseClient,
  body: Record<string, unknown>,
  workspaceId?: string | null,
  phoneNumberId?: string | null
): Promise<string | undefined> {
  const ws = String(workspaceId || activeWorkspaceId || '').trim();
  const channel = ws ? await resolveWhatsAppChannel(db, ws, phoneNumberId) : null;
  const phoneId = String(channel?.external_id || channel?.credentials?.phone_number_id || process.env.META_PHONE_NUMBER_ID || '').trim();
  const token = String(channel?.credentials?.access_token || process.env.META_ACCESS_TOKEN || '').trim();
  if (!phoneId || !token) {
    throw new Error('WhatsApp não configurado para este workspace.');
  }
  const version = process.env.META_GRAPH_VERSION?.trim() || 'v19.0';
  const url = `https://graph.facebook.com/${version}/${phoneId}/messages`;
  const response = await axios.post<{ messages?: Array<{ id?: string }> }>(url, body, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data?.messages?.[0]?.id;
}
