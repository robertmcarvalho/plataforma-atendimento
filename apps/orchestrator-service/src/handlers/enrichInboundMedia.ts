import {
  extractInboundDisplayContent,
  extractInboundMediaRef,
  fetchMetaMediaBuffer,
  isMediaMessageType,
  resolveWhatsAppChannel,
  uploadMessageMediaToStorage,
} from '@plataforma/channel-runtime';
import { supabase, orchestratorConsole as console } from '../lib/orchestratorContext';
import type { InboundAutomationJob } from '../lib/publishInboundAutomation';

/**
 * Baixa mídia inbound da Meta, salva no Storage e atualiza messages.media_url.
 */
export async function enrichInboundMedia(job: InboundAutomationJob): Promise<void> {
  const msg = job.payload;
  const type = String(msg.type || '').trim().toLowerCase();
  if (!isMediaMessageType(type)) return;

  const messageId = String(job.persist.message_id || '').trim();
  if (!messageId) return;

  const mediaRef = extractInboundMediaRef(msg);
  if (!mediaRef?.mediaId) {
    console.warn('[Orchestrator] mídia inbound sem media_id', job.persist.meta_message_id);
    return;
  }

  const { data: existing } = await supabase
    .from('messages')
    .select('id, media_url')
    .eq('id', messageId)
    .maybeSingle();
  if (!existing?.id) return;
  if (existing.media_url) return;

  const phoneNumberId = String((job.channel as { phone_number_id?: string } | null)?.phone_number_id || '').trim() || null;
  const channel = await resolveWhatsAppChannel(supabase, job.workspace_id, phoneNumberId);
  let accessToken = String(channel?.credentials?.access_token || '').trim();
  if (!accessToken) accessToken = String(process.env.META_ACCESS_TOKEN || '').trim();
  if (!accessToken) {
    console.warn('[Orchestrator] enrichInboundMedia: token Meta ausente', {
      message_id: messageId,
      phone_number_id: phoneNumberId,
      channel_id: channel?.id || null,
    });
    return;
  }

  try {
    const downloaded = await fetchMetaMediaBuffer({
      accessToken,
      mediaId: mediaRef.mediaId,
      filenameHint: mediaRef.filename,
      messageTypeHint: type === 'sticker' ? 'image' : type,
    });

    const mediaUrl = await uploadMessageMediaToStorage({
      supabase,
      buffer: downloaded.buffer,
      fileName: downloaded.fileName,
      mimeType: downloaded.mimeType,
    });

    const content = extractInboundDisplayContent(msg);
    await supabase
      .from('messages')
      .update({
        media_url: mediaUrl,
        content: content || null,
      })
      .eq('id', messageId);

    console.info('[Orchestrator] mídia inbound enriquecida', {
      message_id: messageId,
      type,
      media_id: mediaRef.mediaId,
    });
  } catch (err) {
    console.error('[Orchestrator] enrichInboundMedia falhou', {
      message_id: messageId,
      media_id: mediaRef.mediaId,
      err,
    });
  }
}
