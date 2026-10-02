import { contextFromPubSubEnvelope, normalizeError } from '@plataforma/logger';
import { pubsub, logger } from './lib/orchestratorContext';
import { persistInboundFast } from './handlers/persistInboundFast';
import { processInboundAutomation } from './handlers/processInboundAutomation';
import type { InboundAutomationJob } from './lib/publishInboundAutomation';
import { handleStatusUpdate } from './handlers/inboundMessage';

export function bindOrchestratorSubscriptions() {
  const inboundSub = process.env.PUBSUB_SUBSCRIPTION_INBOUND;
  const autoSub = process.env.PUBSUB_SUBSCRIPTION_INBOUND_AUTO;
  const autoTopic = process.env.PUBSUB_TOPIC_INBOUND_AUTO;
  if (!inboundSub) throw new Error('PUBSUB_SUBSCRIPTION_INBOUND não configurado');
  if (!autoSub) throw new Error('PUBSUB_SUBSCRIPTION_INBOUND_AUTO não configurado');
  if (!autoTopic) throw new Error('PUBSUB_TOPIC_INBOUND_AUTO não configurado');

  bindInboundPersistSubscription(inboundSub);
  bindInboundAutomationSubscription(autoSub);
  if (process.env.PUBSUB_SUBSCRIPTION_STATUS) {
    bindStatusSubscription(process.env.PUBSUB_SUBSCRIPTION_STATUS);
  }
}

function bindInboundPersistSubscription(subscriptionName: string) {
  const subscription = pubsub.subscription(subscriptionName);
  const ackExtensionSec = Math.max(30, Number(process.env.PUBSUB_ACK_EXTENSION_SEC || 120));

  subscription.on('message', async (message) => {
    let log = logger.child({ queue_name: subscriptionName, phase: 'persist' });
    try {
      message.modAck(ackExtensionSec);
      const data = JSON.parse(message.data.toString());
      log = logger.child({ ...contextFromPubSubEnvelope(data), queue_name: subscriptionName, phase: 'persist' });
      if (data.type !== 'message') {
        message.ack();
        return;
      }
      await persistInboundFast(data.payload, data.workspace_id || null, data.channel || null);
      message.ack();
    } catch (err) {
      log.error('Erro ao persistir inbound Pub/Sub', {
        event_type: 'pubsub.persist_failed',
        ...normalizeError(err, 'WORKER_ERROR'),
      });
      message.nack();
    }
  });

  subscription.on('error', (err) =>
    logger.error('Erro na subscription persist Pub/Sub', {
      queue_name: subscriptionName,
      event_type: 'pubsub.subscription_error',
      ...normalizeError(err, 'PUBSUB_TIMEOUT'),
    })
  );
}

function bindInboundAutomationSubscription(subscriptionName: string) {
  const subscription = pubsub.subscription(subscriptionName);
  const ackExtensionSec = Math.max(60, Number(process.env.PUBSUB_ACK_EXTENSION_AUTO_SEC || 300));

  subscription.on('message', async (message) => {
    let log = logger.child({ queue_name: subscriptionName, phase: 'automation' });
    try {
      message.modAck(ackExtensionSec);
      const data = JSON.parse(message.data.toString()) as InboundAutomationJob;
      log = logger.child({
        ...contextFromPubSubEnvelope(data),
        queue_name: subscriptionName,
        phase: 'automation',
        automation_kind: data.automation_kind,
      });
      if (data.type !== 'inbound_automation' || !data.persist?.meta_message_id) {
        message.ack();
        return;
      }
      await processInboundAutomation(data);
      message.ack();
    } catch (err) {
      log.error('Erro na automação inbound Pub/Sub', {
        event_type: 'pubsub.automation_failed',
        ...normalizeError(err, 'WORKER_ERROR'),
      });
      message.nack();
    }
  });

  subscription.on('error', (err) =>
    logger.error('Erro na subscription automation Pub/Sub', {
      queue_name: subscriptionName,
      event_type: 'pubsub.subscription_error',
      ...normalizeError(err, 'PUBSUB_TIMEOUT'),
    })
  );
}

function bindStatusSubscription(subscriptionName: string) {
  const subscription = pubsub.subscription(subscriptionName);
  const ackExtensionSec = Math.max(30, Number(process.env.PUBSUB_ACK_EXTENSION_SEC || 120));

  subscription.on('message', async (message) => {
    let log = logger.child({ queue_name: subscriptionName, phase: 'status' });
    try {
      message.modAck(ackExtensionSec);
      const data = JSON.parse(message.data.toString());
      log = logger.child({ ...contextFromPubSubEnvelope(data), queue_name: subscriptionName, phase: 'status' });
      if (data.type === 'status') {
        await handleStatusUpdate(data.payload, data.workspace_id || null);
      }
      message.ack();
    } catch (err) {
      log.error('Erro ao processar status Pub/Sub', {
        event_type: 'pubsub.status_failed',
        ...normalizeError(err, 'WORKER_ERROR'),
      });
      message.nack();
    }
  });

  subscription.on('error', (err) =>
    logger.error('Erro na subscription status Pub/Sub', {
      queue_name: subscriptionName,
      event_type: 'pubsub.subscription_error',
      ...normalizeError(err, 'PUBSUB_TIMEOUT'),
    })
  );
}
