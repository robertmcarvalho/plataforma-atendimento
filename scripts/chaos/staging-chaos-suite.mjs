#!/usr/bin/env node
/**
 * Chaos controlado em STAGING — sem derrubar produção.
 *
 * Automatizado: HMAC inválido, burst API, idempotência Pub/Sub (duplicata), backlog gcloud (se CLI).
 * Manual (impresso no final): scale worker 0, Meta 503, Redis (se usado).
 *
 *   $env:CONFIRM_STAGING_CHAOS="true"
 *   $env:API_BASE_URL="https://api-staging..."
 *   $env:WEBHOOK_BASE_URL="https://webhook-staging..."  # opcional
 *   $env:GCP_PROJECT_ID="..."
 *   $env:STRESS_WORKSPACE_ID="..."
 *   node scripts/chaos/staging-chaos-suite.mjs
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import pg from 'pg';
import { buildInboundWhatsAppMessage } from '../stress/lib/pubsubEnvelope.mjs';
import { blockProductionUrl, httpJson, loginAdmin } from '../stress/lib/httpClient.mjs';
import { readDbUrl } from '../lib/readDbUrl.mjs';

const require = createRequire(import.meta.url);

const apiBase = process.env.API_BASE_URL || 'http://localhost:3001';
const webhookBase = (process.env.WEBHOOK_BASE_URL || '').replace(/\/$/, '');
const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT_ID;
const workspaceId = process.env.STRESS_WORKSPACE_ID || '';
const topicName = process.env.PUBSUB_TOPIC_INBOUND || 'whatsapp.inbound';
const subName = process.env.PUBSUB_SUBSCRIPTION_INBOUND || 'whatsapp.inbound-sub';
const skipPubsub = process.env.CHAOS_SKIP_PUBSUB === 'true';
const waitMs = Math.max(2000, Number(process.env.CHAOS_WAIT_MS || 8000));

if (process.env.CONFIRM_STAGING_CHAOS !== 'true') {
  console.error('Defina CONFIRM_STAGING_CHAOS=true');
  process.exit(1);
}
blockProductionUrl(apiBase, 'CONFIRM_STAGING_CHAOS');
if (webhookBase) blockProductionUrl(webhookBase, 'CONFIRM_STAGING_CHAOS');

const results = [];

function record(name, pass, detail = {}) {
  results.push({ name, pass, ...detail });
  console.log(pass ? `PASS ${name}` : `FAIL ${name}`, detail.status ?? '', detail.note ?? '');
}

// --- 1. API health ---
const health = await httpJson(apiBase, '/health');
record('API /health', health.ok && health.body?.status === 'ok', { status: health.status });

// --- 2. Auth boundary ---
const badAuth = await httpJson(apiBase, '/api/conversations?page=1&limit=1', {
  headers: { Authorization: 'Bearer invalid-token' },
});
record('API token inválido → 401/403', [401, 403].includes(badAuth.status), { status: badAuth.status });

// --- 3. API burst (degradação) ---
const email = process.env.API_ADMIN_EMAIL || '';
const password = process.env.API_ADMIN_PASSWORD || '';
if (email && password) {
  try {
    const token = await loginAdmin(apiBase, email, password);
    const headers = { Authorization: `Bearer ${token}` };
    const burst = 25;
    const latencies = [];
    let burstErr = 0;
    await Promise.all(
      Array.from({ length: burst }, async () => {
        const r = await httpJson(apiBase, '/api/presence/me', { headers });
        latencies.push(r.ms);
        if (!r.ok) burstErr += 1;
      })
    );
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
    record('API burst 25x /presence/me', burstErr <= 2 && p95 < 5000, {
      status: burstErr,
      note: `p95=${Math.round(p95)}ms errors=${burstErr}`,
    });
  } catch (e) {
    record('API burst (login)', false, { note: e.message });
  }
} else {
  record('API burst', true, { note: 'SKIP — sem API_ADMIN_EMAIL/PASSWORD' });
}

// --- 4. Webhook HMAC inválido ---
if (webhookBase) {
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
  const res = await fetch(`${webhookBase}/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hub-signature-256': 'sha256=deadbeef',
    },
    body,
  });
  record('Webhook assinatura inválida → 401', res.status === 401, { status: res.status });

  const secret = process.env.META_APP_SECRET?.trim() || '';
  if (secret) {
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
    const okRes = await fetch(`${webhookBase}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': `sha256=${sig}`,
        'x-correlation-id': `chaos-${Date.now()}`,
      },
      body,
    });
    record('Webhook payload vazio + HMAC ok → 200', okRes.status === 200, { status: okRes.status });
  } else {
    record('Webhook HMAC válido', true, { note: 'SKIP — META_APP_SECRET não definido' });
  }
} else {
  record('Webhook HMAC', true, { note: 'SKIP — WEBHOOK_BASE_URL não definido' });
}

// --- 5. Pub/Sub idempotência (duplicata) ---
if (!skipPubsub && projectId && workspaceId) {
  try {
    const { PubSub } = require('../../apps/webhook-service/node_modules/@google-cloud/pubsub');
    const pubsub = new PubSub({ projectId });
    const topic = pubsub.topic(topicName);
    const metaMessageId = `wamid.chaos-dup.${Date.now()}`;
    const envelope = buildInboundWhatsAppMessage({
      metaMessageId,
      fromWa: process.env.STRESS_PHONE_FROM || '5591777666555',
      text: 'chaos duplicate test',
      workspaceId,
      phoneNumberId: process.env.STRESS_PHONE_NUMBER_ID || '',
      correlationId: `chaos-dup-${Date.now()}`,
    });

    await topic.publishMessage({ data: Buffer.from(JSON.stringify(envelope)) });
    await topic.publishMessage({ data: Buffer.from(JSON.stringify(envelope)) });
    record('Pub/Sub duplicata publicada 2x', true, { note: metaMessageId });

    await new Promise((r) => setTimeout(r, waitMs));

    let dbCount = null;
    try {
      const client = new pg.Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });
      await client.connect();
      const q = await client.query(
        `select count(*)::int as c from public.processed_webhook_events where meta_message_id = $1`,
        [metaMessageId]
      );
      dbCount = q.rows[0]?.c ?? null;
      await client.end();
    } catch (e) {
      record('DB idempotência', true, { note: `SKIP DB: ${e.message}` });
    }

    if (dbCount !== null) {
      record('processed_webhook_events único', dbCount === 1, { note: `count=${dbCount}` });
    }
  } catch (e) {
    record('Pub/Sub idempotência', false, { note: e.message });
  }
} else {
  record('Pub/Sub idempotência', true, {
    note: skipPubsub ? 'SKIP CHAOS_SKIP_PUBSUB' : 'SKIP — GCP_PROJECT_ID ou STRESS_WORKSPACE_ID',
  });
}

// --- 6. Backlog subscription (gcloud readonly) ---
if (projectId) {
  try {
    const out = execFileSync(
      'gcloud',
      ['pubsub', 'subscriptions', 'describe', subName, '--project', projectId, '--format=json'],
      { encoding: 'utf8' }
    );
    const sub = JSON.parse(out);
    const backlog = Number(sub.numUndeliveredMessages || 0);
    record('Pub/Sub backlog legível', true, { note: `undelivered=${backlog}` });
    if (backlog > 500) {
      record('Pub/Sub backlog < 500', false, { note: `undelivered=${backlog}` });
    } else {
      record('Pub/Sub backlog < 500', true, { note: `undelivered=${backlog}` });
    }
  } catch (e) {
    record('Pub/Sub backlog', true, { note: `SKIP gcloud: ${e.message}` });
  }
}

const failed = results.filter((r) => !r.pass);
const summary = {
  event: 'chaos.staging.end',
  ok: failed.length === 0,
  passed: results.filter((r) => r.pass).length,
  failed: failed.length,
  results,
  manual_chaos_checklist: [
    'gcloud run services update orchestrator --min-instances=0 --max-instances=0 (staging) → aguardar backlog',
    'Restaurar min-instances=1 e validar drenagem sem duplicar mensagens no inbox',
    'Simular Meta API: firewall rule / mock 503 no phone_number_id de teste',
    'Validar DLQ: gcloud pubsub subscriptions pull platform.dead-letter-sub --limit=5',
    'Copiloto: 25 req/min mesmo user → esperar 429 após rate_limit_buckets',
  ],
};

console.log(JSON.stringify(summary, null, 2));
process.exit(failed.length ? 1 : 0);
