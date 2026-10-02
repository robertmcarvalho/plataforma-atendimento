import { resolveWhatsAppChannel } from '@plataforma/channel-runtime';
import { supabase, orchestratorConsole as console } from '../lib/orchestratorContext';
import { isUuid } from '../lib/orchestratorUtils';
import { persistInboundFast } from './persistInboundFast';

type InboundChannelEnvelope = {
  workspace_channel_id?: unknown;
  channel_type?: unknown;
  phone_number_id?: unknown;
};

export async function resolveInboundWorkspaceChannelId(
  workspaceId: string,
  channel: InboundChannelEnvelope | null
): Promise<string | null> {
  const directId = String(channel?.workspace_channel_id || '').trim();
  if (isUuid(directId)) return directId;

  const channelType = String(channel?.channel_type || '').trim();
  if (channelType === 'whatsapp') {
    const phoneNumberId = String(channel?.phone_number_id || '').trim();
    const resolved = await resolveWhatsAppChannel(supabase, workspaceId, phoneNumberId);
    if (resolved?.source === 'workspace' && isUuid(resolved.id)) return resolved.id;
  }

  return null;
}

/** @deprecated Use persistInboundFast via pubsubBinding. Mantido para testes/scripts. */
export async function handleInboundMessage(
  msg: Record<string, unknown>,
  workspaceId: string | null,
  channel: InboundChannelEnvelope | null,
  _intakeHints?: Record<string, unknown> | null
) {
  const result = await persistInboundFast(msg, workspaceId, channel);
  if (result.kind === 'skipped') {
    console.warn('[Orchestrator] handleInboundMessage: skipped');
  }
}

export async function handleStatusUpdate(status: { id: string; status: string }, workspaceId: string | null) {
  const updates: Record<string, string> = {};
  if (status.status === 'delivered') updates.delivered_at = new Date().toISOString();
  if (status.status === 'read') updates.read_at = new Date().toISOString();

  if (Object.keys(updates).length > 0) {
    updates.status = status.status;
    let query = supabase.from('messages').update(updates).eq('meta_message_id', status.id);
    if (workspaceId) query = query.eq('workspace_id', workspaceId);
    await query;
  }
}
