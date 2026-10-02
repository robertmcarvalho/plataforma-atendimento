import 'dotenv/config';
import crypto from 'crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PubSub } from '@google-cloud/pubsub';
import { createClient } from '@supabase/supabase-js';
import { listActiveVerifyTokens, resolveWorkspaceIdByPhoneNumberId } from '@plataforma/channel-runtime';
import { buildPubSubEnvelope, createLogger, getCorrelationId, normalizeError } from '@plataforma/logger';

const logger = createLogger('webhook-service');
const app = Fastify({ logger: false });
const pubsub = new PubSub({ projectId: process.env.GOOGLE_CLOUD_PROJECT_ID });
const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;
const rawBodyStore = new WeakMap<object, Buffer>();

type WebhookMessage = {
  id: string;
  from?: string;
  type: string;
  text?: { body?: string };
  contacts?: Array<{ profile?: { name?: string } }>;
};

type WebhookStatus = {
  id: string;
  status: string;
  timestamp: string;
};

type WebhookValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  messages?: WebhookMessage[];
  statuses?: WebhookStatus[];
};

type WebhookEntry = {
  changes?: Array<{ value?: WebhookValue }>;
};

// Meta webhook is server-to-server; no browser CORS needed.
app.register(cors, { origin: false });

app.addHook('onRequest', async (request, reply) => {
  const correlationId = getCorrelationId((request.headers['x-correlation-id'] as string | undefined) || (request.headers['x-request-id'] as string | undefined));
  request.headers['x-correlation-id'] = correlationId;
  reply.header('x-correlation-id', correlationId);
});

app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
  try {
    const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
    rawBodyStore.set(request, rawBody);
    done(null, JSON.parse(rawBody.toString('utf8')));
  } catch (error) {
    done(error as Error, undefined);
  }
});

app.get('/health', async () => ({ status: 'ok', service: 'webhook-service' }));

app.get('/webhook', async (request, reply) => {
  const {
    'hub.mode': mode,
    'hub.verify_token': token,
    'hub.challenge': challenge,
  } = request.query as Record<string, string>;

  const allowed = supabase ? await listActiveVerifyTokens(supabase) : [];
  const envToken = process.env.META_VERIFY_TOKEN?.trim();
  if (envToken && !allowed.includes(envToken)) allowed.push(envToken);

  if (mode === 'subscribe' && token && allowed.includes(token)) {
    logger.info('Webhook verificado com sucesso', { event_type: 'webhook.verified' });
    return reply.send(challenge);
  }

  return reply.status(403).send({ error: 'Token de verificacao invalido' });
});

app.post('/webhook', async (request, reply) => {
  const signature = (request.headers['x-hub-signature-256'] as string | undefined)?.replace('sha256=', '');
  const body = rawBodyStore.get(request);

  if (!body || !validateHMAC(body, signature)) {
    logger.warn('Assinatura HMAC invalida; evento descartado', { event_type: 'webhook.invalid_signature', error_code: 'WEBHOOK_ERROR' });
    return reply.status(401).send({ error: 'Assinatura invalida' });
  }

  const correlationId = String(request.headers['x-correlation-id'] || '');
  try {
    await processWebhookAsync(request.body as Record<string, unknown>, correlationId);
    return reply.status(200).send('OK');
  } catch (err) {
    logger.error('Erro ao processar webhook', { event_type: 'webhook.processing_failed', correlation_id: correlationId, ...normalizeError(err, 'WEBHOOK_ERROR') });
    return reply.status(500).send({ error: 'Falha ao processar webhook' });
  }
});

function validateHMAC(body: Buffer, signature?: string): boolean {
  if (process.env.WEBHOOK_SKIP_SIGNATURE_VERIFY === 'true' && process.env.NODE_ENV !== 'production') {
    logger.warn('WEBHOOK_SKIP_SIGNATURE_VERIFY=true — validação HMAC ignorada (apenas desenvolvimento)', { event_type: 'webhook.signature_skip_dev' });
    return true;
  }

  if (!signature) {
    return false;
  }

  const secret = process.env.META_APP_SECRET?.trim() || '';
  if (!secret) {
    logger.warn('META_APP_SECRET não definido; rejeitando assinatura HMAC', { event_type: 'webhook.missing_secret', error_code: 'WEBHOOK_ERROR' });
    return false;
  }

  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function processWebhookAsync(payload: Record<string, unknown>, correlationId: string) {
  const entry = (payload.entry as WebhookEntry[] | undefined) || [];

  for (const currentEntry of entry) {
    for (const change of currentEntry.changes || []) {
      const value = change.value;
      if (!value) {
        continue;
      }

      const workspaceId = await resolveWorkspaceIdForValue(value);

      if (value.messages?.length) {
        for (const message of value.messages) {
          const phoneNumberId = String(value.metadata?.phone_number_id || '').trim();
          const fromWa = String(message.from || '').trim();

          const data = Buffer.from(JSON.stringify(buildPubSubEnvelope({
            type: 'message',
            payload: message,
            workspace_id: workspaceId,
            channel: {
              provider: 'meta_cloud',
              channel_type: 'whatsapp',
              phone_number_id: phoneNumberId || null,
              display_phone_number: value.metadata?.display_phone_number || null,
              workspace_channel_id: null,
            },
            raw_entry: currentEntry,
          }, { correlation_id: correlationId, workspace_id: workspaceId })));

          await pubsub.topic(process.env.PUBSUB_TOPIC_INBOUND!).publishMessage({ data });
          logger.info('Mensagem publicada no Pub/Sub', {
            event_type: 'pubsub.publish',
            correlation_id: correlationId,
            workspace_id: workspaceId,
            queue_name: process.env.PUBSUB_TOPIC_INBOUND || null,
            message_id: message.id,
          });
        }
      }

      if (value.statuses?.length) {
        for (const status of value.statuses) {
          const data = Buffer.from(
              JSON.stringify(buildPubSubEnvelope({
              type: 'status',
              payload: status,
              workspace_id: workspaceId,
              channel: {
                provider: 'meta_cloud',
                channel_type: 'whatsapp',
                phone_number_id: value.metadata?.phone_number_id || null,
                display_phone_number: value.metadata?.display_phone_number || null,
              },
            }, { correlation_id: correlationId, workspace_id: workspaceId }))
          );
          await pubsub.topic(process.env.PUBSUB_TOPIC_STATUS!).publishMessage({ data });
        }
      }
    }
  }
}

async function resolveWorkspaceIdForValue(value: WebhookValue): Promise<string | null> {
  if (!supabase) return null;
  const phoneNumberId = String(value.metadata?.phone_number_id || '').trim();
  if (phoneNumberId) {
    const ws = await resolveWorkspaceIdByPhoneNumberId(supabase, phoneNumberId);
    if (ws) return ws;
  }

  const { data: defaultWorkspace } = await supabase
    .from('workspaces')
    .select('id')
    .order('created_at')
    .limit(1)
    .maybeSingle();
  return defaultWorkspace?.id ? String(defaultWorkspace.id) : null;
}

const start = async () => {
  const port = Number(process.env.PORT) || 3002;
  await app.listen({ port, host: '0.0.0.0' });
  logger.info('Webhook Service rodando', { event_type: 'service.started', port });
};

start().catch((err) => {
  logger.error('Webhook Service falhou ao iniciar', { event_type: 'service.start_failed', ...normalizeError(err, 'WORKER_ERROR') });
  process.exit(1);
});
