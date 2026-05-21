#!/usr/bin/env node
/**
 * Publica mensagens inbound simuladas no Pub/Sub (STAGING apenas).
 *
 * Requer ADC/gcloud auth e permissão pubsub.publisher.
 *
 *   $env:CONFIRM_STAGING_PUBSUB_STRESS="true"
 *   $env:GCP_PROJECT_ID="rh-coopmob-bot"
 *   $env:STRESS_WORKSPACE_ID="<uuid>"
 *   $env:STRESS_MESSAGE_COUNT="100"
 *   $env:STRESS_PUBLISH_CONCURRENCY="15"
 *   node scripts/stress/staging-pubsub-inbound-flood.mjs
 */
import { createRequire } from 'node:module';
import { buildInboundWhatsAppMessage } from './lib/pubsubEnvelope.mjs';

const require = createRequire(import.meta.url);
const { PubSub } = require('../../apps/webhook-service/node_modules/@google-cloud/pubsub');

const projectId = process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT_ID;
const topicName = process.env.PUBSUB_TOPIC_INBOUND || 'whatsapp.inbound';
const workspaceId = process.env.STRESS_WORKSPACE_ID || process.env.SMOKE_WORKSPACE_ID || '';
const phoneFrom = (process.env.STRESS_PHONE_FROM || '5591888777666').replace(/\D/g, '');
const phoneNumberId = process.env.STRESS_PHONE_NUMBER_ID || '';
const total = Math.min(500, Math.max(1, Number(process.env.STRESS_MESSAGE_COUNT || 50)));
const concurrency = Math.min(50, Math.max(1, Number(process.env.STRESS_PUBLISH_CONCURRENCY || 10)));

if (process.env.CONFIRM_STAGING_PUBSUB_STRESS !== 'true') {
  console.error('Defina CONFIRM_STAGING_PUBSUB_STRESS=true');
  process.exit(1);
}
if (!projectId || !workspaceId) {
  console.error('Defina GCP_PROJECT_ID e STRESS_WORKSPACE_ID');
  process.exit(1);
}

const pubsub = new PubSub({ projectId });
const topic = pubsub.topic(topicName);
const runId = `stress-${Date.now()}`;
const started = Date.now();
let published = 0;
let failed = 0;
let cursor = 0;

async function publishOne(i) {
  const metaMessageId = `wamid.${runId}.${i}`;
  const envelope = buildInboundWhatsAppMessage({
    metaMessageId,
    fromWa: phoneFrom,
    text: `Stress inbound #${i} ${new Date().toISOString()}`,
    workspaceId,
    phoneNumberId,
    correlationId: `${runId}-${i}`,
  });
  try {
    await topic.publishMessage({ data: Buffer.from(JSON.stringify(envelope)) });
    published += 1;
  } catch (e) {
    failed += 1;
    if (failed <= 3) console.error('publish error', e?.message || e);
  }
}

async function worker() {
  while (cursor < total) {
    const i = cursor++;
    await publishOne(i);
  }
}

console.log(
  JSON.stringify(
    { event: 'pubsub.stress.start', projectId, topicName, workspaceId, total, concurrency, runId },
    null,
    2
  )
);

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const elapsedSec = ((Date.now() - started) / 1000).toFixed(2);
const report = {
  event: 'pubsub.stress.end',
  runId,
  published,
  failed,
  elapsed_sec: Number(elapsedSec),
  publish_per_sec: published ? Number((published / Number(elapsedSec)).toFixed(2)) : 0,
  next_steps: [
    'Monitorar backlog: gcloud pubsub subscriptions describe whatsapp.inbound-sub',
    'Verificar logs orchestrator com correlation_id prefix stress-',
    'Confirmar idempotência com scripts/chaos/staging-chaos-suite.mjs',
  ],
};

console.log(JSON.stringify(report, null, 2));
if (failed > published * 0.05) process.exit(1);
