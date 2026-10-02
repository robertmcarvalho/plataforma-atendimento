const MS_24H = 24 * 60 * 60 * 1000;

type InboundMessage = {
  direction?: string | null;
  created_at?: string | null;
};

/** Espelha `lastInboundWithin24h` da API — janela Meta aberta após mensagem inbound do cliente. */
export function isWithinWhatsAppMessagingWindow(messages: InboundMessage[] | undefined | null): boolean {
  if (!messages?.length) return false;
  let lastInboundAt: string | null = null;
  for (const msg of messages) {
    if (msg.direction !== 'inbound') continue;
    const at = String(msg.created_at || '').trim();
    if (!at) continue;
    if (!lastInboundAt || at > lastInboundAt) lastInboundAt = at;
  }
  if (!lastInboundAt) return false;
  return Date.now() - new Date(lastInboundAt).getTime() < MS_24H;
}
