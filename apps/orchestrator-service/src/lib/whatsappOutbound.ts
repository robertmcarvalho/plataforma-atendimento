import type { SupabaseClient } from '@supabase/supabase-js';
import axios from 'axios';
import { onlyDigits, resolveWhatsAppChannel } from '@plataforma/channel-runtime';

let activeWorkspaceId: string | null = null;
let activePhoneNumberId: string | null = null;

export function setOutboundWorkspaceId(workspaceId: string | null): void {
  activeWorkspaceId = workspaceId ? String(workspaceId).trim() || null : null;
}

export function setOutboundPhoneNumberId(phoneNumberId: string | null): void {
  activePhoneNumberId = phoneNumberId ? String(phoneNumberId).trim() || null : null;
}

export async function postWhatsAppMessage(
  db: SupabaseClient,
  body: Record<string, unknown>,
  workspaceId?: string | null,
  phoneNumberId?: string | null
): Promise<string | undefined> {
  const ws = String(workspaceId || activeWorkspaceId || '').trim();
  const resolvedPhoneId = String(phoneNumberId || activePhoneNumberId || '').trim() || null;
  const channel = ws ? await resolveWhatsAppChannel(db, ws, resolvedPhoneId) : null;
  const phoneId = String(channel?.external_id || channel?.credentials?.phone_number_id || process.env.META_PHONE_NUMBER_ID || '').trim();
  const token = String(channel?.credentials?.access_token || process.env.META_ACCESS_TOKEN || '').trim();
  if (!phoneId || !token) {
    throw new Error('WhatsApp não configurado para este workspace.');
  }
  const payload = { ...body };
  if (typeof payload.to === 'string') {
    payload.to = onlyDigits(payload.to);
  }

  const version = process.env.META_GRAPH_VERSION?.trim() || 'v19.0';
  const url = `https://graph.facebook.com/${version}/${phoneId}/messages`;
  const response = await axios.post<{ messages?: Array<{ id?: string }> }>(url, payload, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.data?.messages?.[0]?.id;
}
