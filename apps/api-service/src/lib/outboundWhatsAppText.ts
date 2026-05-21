import { supabase } from './supabase';

const META_MESSAGES_API_URL = `https://graph.facebook.com/v19.0/${process.env.META_PHONE_NUMBER_ID}/messages`;

async function sendWhatsAppJson(payload: object) {
  if (!process.env.META_ACCESS_TOKEN || !process.env.META_PHONE_NUMBER_ID) {
    throw new Error('Meta WhatsApp nao configurado (META_ACCESS_TOKEN/META_PHONE_NUMBER_ID).');
  }
  const response = await fetch(META_MESSAGES_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
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

/** Envia texto outbound para o WhatsApp da conversa (Meta ou fallback dev, espelhando POST /api/messages/send). */
export async function sendOutboundWhatsAppText(conversationId: string, text: string): Promise<void> {
  const { data } = await supabase
    .from('conversations')
    .select('id, contacts(wa_phone)')
    .eq('id', conversationId)
    .single();

  const contact = Array.isArray(data?.contacts) ? data?.contacts[0] : (data as { contacts?: { wa_phone?: string } | null })?.contacts;
  const to = contact?.wa_phone;
  if (!to) throw new Error('conversation_phone_missing');

  const metaEnabled = Boolean(process.env.META_ACCESS_TOKEN && process.env.META_PHONE_NUMBER_ID);
  const textBody = text.trim();

  if (!metaEnabled) {
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      meta_message_id: null,
      direction: 'outbound',
      type: 'text',
      content: textBody,
      status: 'sent',
      sent_at: new Date().toISOString(),
    });
    await supabase
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString(),
        status: 'open',
        has_unread: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
    return;
  }

  const metaResponse = await sendWhatsAppJson({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: textBody, preview_url: false },
  });

  await supabase.from('messages').insert({
    conversation_id: conversationId,
    meta_message_id: metaResponse.messages?.[0]?.id || null,
    direction: 'outbound',
    type: 'text',
    content: textBody,
    status: 'sent',
    sent_at: new Date().toISOString(),
  });
  await supabase
    .from('conversations')
    .update({
      last_message_at: new Date().toISOString(),
      status: 'open',
      has_unread: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);
}
