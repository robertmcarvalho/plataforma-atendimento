import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase';
import { canCallAutentiqueApi } from '@plataforma/operational-notes';
import {
  processAutentiqueWebhookPayload,
  recordWebhookIdempotency,
} from '../lib/signatureStatusSync';

function verifyWebhookSecret(headers: Record<string, unknown>, rawBody: string): boolean {
  const secret = process.env.AUTENTIQUE_WEBHOOK_SECRET?.trim();
  if (!secret) return process.env.NODE_ENV !== 'production';
  const headerSecret = String(headers['x-autentique-secret'] || headers['x-webhook-secret'] || '');
  if (headerSecret && headerSecret === secret) return true;
  return rawBody.includes(secret);
}

export async function webhooksAutentiqueRoutes(app: FastifyInstance) {
  app.post('/autentique', { config: { rawBody: true } }, async (request, reply) => {
    if (!canCallAutentiqueApi()) {
      return reply.status(200).send({ ok: true, paused: true });
    }
    const raw = typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? {});
    if (!verifyWebhookSecret(request.headers as Record<string, unknown>, raw)) {
      return reply.status(401).send({ error: 'Webhook não autorizado' });
    }

    let payload: Record<string, unknown>;
    try {
      payload = typeof request.body === 'object' && request.body ? (request.body as Record<string, unknown>) : JSON.parse(raw);
    } catch {
      return reply.status(400).send({ error: 'JSON inválido' });
    }

    const eventId = String(
      payload.id || payload.event_id || `${payload.type || 'event'}-${Date.now()}`
    );
    const eventType = String(payload.type || payload.event || 'autentique');

    void (async () => {
      try {
        const { data: ws } = await supabase.from('workspaces').select('id').limit(1).maybeSingle();
        const workspaceId = String(ws?.id || '00000000-0000-0000-0000-000000000000');
        const fresh = await recordWebhookIdempotency(supabase, workspaceId, eventId, eventType);
        if (!fresh) return;
        await processAutentiqueWebhookPayload(supabase, payload);
      } catch (err) {
        request.log.error({ err }, 'Falha ao processar webhook Autentique');
      }
    })();

    return reply.status(200).send({ ok: true });
  });
}
