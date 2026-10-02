import { buildPubSubEnvelope } from '@plataforma/logger';
import { canonicalBrazilWaPhone } from '@plataforma/channel-runtime';
import { pubsub } from './orchestratorContext';

export type InboundAutomationKind = 'csat' | 'standard';

export type InboundAutomationPersist = {
  contact_id: string;
  conversation_id: string | null;
  message_id: string | null;
  workspace_channel_id: string | null;
  wa_phone: string;
  meta_message_id: string;
};

export type InboundAutomationJob = {
  type: 'inbound_automation';
  automation_kind: InboundAutomationKind;
  workspace_id: string;
  channel: Record<string, unknown> | null;
  payload: Record<string, unknown>;
  persist: InboundAutomationPersist;
};

export async function publishInboundAutomation(job: InboundAutomationJob): Promise<void> {
  const topicName = process.env.PUBSUB_TOPIC_INBOUND_AUTO;
  if (!topicName) {
    throw new Error('PUBSUB_TOPIC_INBOUND_AUTO não configurado');
  }
  const orderingKey = canonicalBrazilWaPhone(job.persist.wa_phone) || job.persist.wa_phone;
  const envelope = buildPubSubEnvelope(job, {
    workspace_id: job.workspace_id,
    conversation_id: job.persist.conversation_id || undefined,
  });
  const topic = pubsub.topic(topicName, { messageOrdering: true });
  await topic.publishMessage({
    data: Buffer.from(JSON.stringify(envelope)),
    orderingKey,
  });
}
