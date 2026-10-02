import type { SupabaseClient } from '@supabase/supabase-js';
import {
  extractInboundMessageText,
  findPendingCsatDispatch,
  parseCsatScoreFromMessage,
  resolveWhatsAppChannel,
  sendWhatsAppTextViaChannel,
} from '@plataforma/channel-runtime';
import { postWhatsAppMessage } from '../lib/whatsappOutbound';

const CSAT_THANK_YOU =
  'Obrigado pela sua avaliação! Sua opinião nos ajuda a melhorar o atendimento.';
const CSAT_REMINDER =
  'Por favor, toque em "Dar nota" e selecione uma opção de 1 a 5 para avaliar o atendimento.';

function extractContent(msg: Record<string, unknown>): string {
  const text = extractInboundMessageText(msg);
  return text || String(msg.type || '');
}

async function sendCsatThankYou(
  db: SupabaseClient,
  workspaceId: string,
  waPhone: string,
  phoneNumberId: string | null | undefined
): Promise<void> {
  const channel = await resolveWhatsAppChannel(db, workspaceId, phoneNumberId || null);
  if (channel?.source === 'workspace') {
    await sendWhatsAppTextViaChannel(channel, waPhone, CSAT_THANK_YOU);
    return;
  }
  await postWhatsAppMessage(
    db,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: waPhone.replace(/\D/g, ''),
      type: 'text',
      text: { body: CSAT_THANK_YOU },
    },
    workspaceId,
    phoneNumberId || null
  );
}

async function sendCsatReminder(
  db: SupabaseClient,
  workspaceId: string,
  waPhone: string,
  phoneNumberId: string | null | undefined
): Promise<void> {
  const channel = await resolveWhatsAppChannel(db, workspaceId, phoneNumberId || null);
  if (channel?.source === 'workspace') {
    await sendWhatsAppTextViaChannel(channel, waPhone, CSAT_REMINDER);
    return;
  }
  await postWhatsAppMessage(
    db,
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: waPhone.replace(/\D/g, ''),
      type: 'text',
      text: { body: CSAT_REMINDER },
    },
    workspaceId,
    phoneNumberId || null
  );
}

export type CsatInboundResult = 'handled' | 'not_pending' | 'continue';

/**
 * Resposta à pesquisa CSAT em conversa resolvida — não abre ticket nem nova conversa.
 */
export async function tryHandleCsatInbound(args: {
  db: SupabaseClient;
  workspaceId: string;
  contactId: string;
  waFrom: string;
  msg: Record<string, unknown>;
  metaMessageId: string;
  phoneNumberId?: string | null;
}): Promise<CsatInboundResult> {
  const pending = await findPendingCsatDispatch(args.db, args.workspaceId, args.contactId);
  if (!pending) return 'not_pending';

  const rawText = extractContent(args.msg);
  const score = parseCsatScoreFromMessage(args.msg);

  const now = new Date().toISOString();
  const conversationId = pending.conversation_id;

  const { data: existingMessage } = await args.db
    .from('messages')
    .select('id')
    .eq('meta_message_id', args.metaMessageId)
    .maybeSingle();
  if (!existingMessage?.id) {
    await args.db.from('messages').insert({
      workspace_id: args.workspaceId,
      conversation_id: conversationId,
      meta_message_id: args.metaMessageId,
      direction: 'inbound',
      type: String(args.msg.type || 'text'),
      content: rawText || String(score || ''),
      status: 'delivered',
      sent_at: now,
    });
  }

  await args.db
    .from('conversations')
    .update({
      last_message_at: now,
      has_unread: false,
      status: 'resolved',
      updated_at: now,
    })
    .eq('workspace_id', args.workspaceId)
    .eq('id', conversationId);

  if (score === null) {
    await sendCsatReminder(args.db, args.workspaceId, args.waFrom, args.phoneNumberId);
    return 'handled';
  }

  const { data: claimed } = await args.db
    .from('contact_csat_dispatches')
    .update({ score, responded_at: now })
    .eq('id', pending.id)
    .is('responded_at', null)
    .select('id')
    .maybeSingle();

  if (!claimed?.id) {
    return 'handled';
  }

  await args.db
    .from('conversations')
    .update({
      csat_score: score,
      csat_responded_at: now,
      status: 'resolved',
      has_unread: false,
      updated_at: now,
    })
    .eq('workspace_id', args.workspaceId)
    .eq('id', conversationId);

  await sendCsatThankYou(args.db, args.workspaceId, args.waFrom, args.phoneNumberId);
  return 'handled';
}

/** Evita abrir ticket/conversa quando há CSAT pendente e a mensagem não é resposta válida. */
export async function hasPendingCsatForContact(
  db: SupabaseClient,
  workspaceId: string,
  contactId: string
): Promise<boolean> {
  const pending = await findPendingCsatDispatch(db, workspaceId, contactId);
  return Boolean(pending?.id);
}
