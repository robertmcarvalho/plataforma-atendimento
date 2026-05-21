/** Espelha @plataforma/logger buildPubSubEnvelope (sem build do pacote). */
export function correlationId(input) {
  const value = String(input || '').trim();
  if (value) return value;
  return `corr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildPubSubEnvelope(payload, context = {}) {
  const currentCorrelationId = correlationId(context.correlation_id);
  return {
    ...payload,
    tracing: {
      request_id: context.request_id || null,
      correlation_id: currentCorrelationId,
      workspace_id: context.workspace_id || null,
      conversation_id: context.conversation_id || null,
      ticket_id: context.ticket_id || null,
      user_id: context.user_id || null,
    },
  };
}

export function buildInboundWhatsAppMessage({
  metaMessageId,
  fromWa,
  text,
  workspaceId,
  phoneNumberId,
  correlationId: corr,
}) {
  const message = {
    id: metaMessageId,
    from: fromWa.replace(/\D/g, ''),
    type: 'text',
    text: { body: text },
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  return buildPubSubEnvelope(
    {
      type: 'message',
      payload: message,
      workspace_id: workspaceId,
      channel: {
        provider: 'meta_cloud',
        channel_type: 'whatsapp',
        phone_number_id: phoneNumberId || null,
        display_phone_number: null,
        workspace_channel_id: null,
      },
    },
    { correlation_id: corr || `stress-${metaMessageId}`, workspace_id: workspaceId }
  );
}
