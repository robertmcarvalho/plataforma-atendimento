import 'dotenv/config';
import { createServer } from 'http';
import { PubSub } from '@google-cloud/pubsub';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { createLogger } from '@plataforma/logger';

type CampaignCounts = {
  pending: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
};

type WhatsAppChannelConfig = {
  phone_number_id: string | null;
  access_token: string | null;
};

const pubsub = new PubSub({ projectId: process.env.GOOGLE_CLOUD_PROJECT_ID });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const logger = createLogger('campaign-worker');
const console = logger.console;

const META_API_URL = `https://graph.facebook.com/v19.0/${process.env.META_PHONE_NUMBER_ID}/messages`;

const DEFAULTS = {
  batch_size: Number(process.env.DEFAULT_BATCH_SIZE) || 10,
  pause_between_messages_ms: Number(process.env.DEFAULT_PAUSE_BETWEEN_MESSAGES_MS) || 1500,
  pause_between_batches_ms: Number(process.env.DEFAULT_PAUSE_BETWEEN_BATCHES_MS) || 60000,
  max_per_hour: Number(process.env.DEFAULT_MAX_PER_HOUR) || 200,
  jitter_ms: Number(process.env.DEFAULT_JITTER_MS) || 500,
  retry_on_failure: true,
  max_retries: 3,
  retry_backoff_ms: 30000,
};

console.log('Campaign Worker iniciando...');

const subscription = pubsub.subscription(process.env.PUBSUB_SUBSCRIPTION_CAMPAIGN!);

subscription.on('message', async (message) => {
  try {
    const job = JSON.parse(message.data.toString());
    await processCampaign(job.campaign_id, job.workspace_id || null);
    message.ack();
  } catch (err) {
    console.error('Erro ao processar job de campanha:', err);
    message.nack();
  }
});

subscription.on('error', (err) => console.error('Erro na subscription:', err));

async function processCampaign(campaignId: string, workspaceId: string | null) {
  console.log(`[Campaign ${campaignId}] Iniciando...`);

  let campaignQuery = supabase
    .from('campaigns')
    .select('*, message_templates(meta_template_name, meta_template_language, variables, body)')
    .eq('id', campaignId);
  if (workspaceId) campaignQuery = campaignQuery.eq('workspace_id', workspaceId);
  const { data: campaign } = await campaignQuery.single();

  if (!campaign) {
    console.log(`[Campaign ${campaignId}] Nao encontrada.`);
    return;
  }

  if (campaign.status !== 'running') {
    console.log(`[Campaign ${campaignId}] Cancelada ou nao encontrada.`);
    const ws = String(campaign.workspace_id || workspaceId || '');
    if (ws) await syncAutomationRunForCampaign(campaignId, ws, campaign.status);
    return;
  }

  const cfg = { ...DEFAULTS, ...(campaign.dispatch_config || {}) } as typeof DEFAULTS;
  const template = campaign.message_templates as Record<string, unknown>;
  const channel = await getWhatsAppChannelConfig(String(campaign.workspace_id || workspaceId || ''));

  let sentThisHour = 0;
  let hourWindowStart = Date.now();
  let hasMore = true;

  while (hasMore) {
    const { data: check } = await supabase
      .from('campaigns')
      .select('status')
      .eq('workspace_id', campaign.workspace_id)
      .eq('id', campaignId)
      .single();

    if (check?.status !== 'running') {
      console.log(`[Campaign ${campaignId}] Pausada ou encerrada.`);
      await syncAutomationRunForCampaign(campaignId, String(campaign.workspace_id || workspaceId || ''), check?.status || 'running');
      break;
    }

    const { data: batch } = await supabase
      .from('campaign_recipients')
      .select('id, wa_phone, variables, retry_count')
      .eq('workspace_id', campaign.workspace_id)
      .eq('campaign_id', campaignId)
      .eq('status', 'pending')
      .limit(cfg.batch_size);

    if (!batch || batch.length === 0) {
      hasMore = false;
      break;
    }

    if (Date.now() - hourWindowStart > 3600000) {
      sentThisHour = 0;
      hourWindowStart = Date.now();
    }

    for (const recipient of batch) {
      const { data: liveCheck } = await supabase
        .from('campaigns')
        .select('status')
        .eq('workspace_id', campaign.workspace_id)
        .eq('id', campaignId)
        .single();

      if (liveCheck?.status !== 'running') {
        await syncAutomationRunForCampaign(campaignId, String(campaign.workspace_id || workspaceId || ''), liveCheck?.status || 'running');
        break;
      }

      if (sentThisHour >= cfg.max_per_hour) {
        const waitMs = 3600000 - (Date.now() - hourWindowStart);
        console.log(`[Campaign ${campaignId}] Limite por hora atingido. Aguardando ${Math.round(waitMs / 60000)} min...`);
        await sleep(waitMs);
        sentThisHour = 0;
        hourWindowStart = Date.now();
      }

      await sendToRecipient(campaignId, String(campaign.workspace_id), recipient, template, cfg, channel);
      await syncAutomationRunForCampaign(campaignId, String(campaign.workspace_id), 'running');
      sentThisHour++;

      const jitter = Math.random() * cfg.jitter_ms * 2 - cfg.jitter_ms;
      await sleep(cfg.pause_between_messages_ms + jitter);
    }

    if (hasMore) {
      console.log(`[Campaign ${campaignId}] Lote concluido. Aguardando ${cfg.pause_between_batches_ms / 1000}s...`);
      await sleep(cfg.pause_between_batches_ms);
    }
  }

  const counts = await getCampaignCounts(campaignId, String(campaign.workspace_id));
  if (counts.pending === 0) {
    const completedAt = new Date().toISOString();

    await supabase
      .from('campaigns')
      .update({
        status: 'completed',
        completed_at: completedAt,
        sent_count: counts.sent,
        delivered_count: counts.delivered,
        read_count: counts.read,
        failed_count: counts.failed,
      })
      .eq('workspace_id', campaign.workspace_id)
      .eq('id', campaignId);

    await syncAutomationRunForCampaign(campaignId, String(campaign.workspace_id), 'completed', counts, completedAt);
    console.log(`[Campaign ${campaignId}] Concluida!`);
    return;
  }

  await syncAutomationRunForCampaign(campaignId, String(campaign.workspace_id), 'running', counts);
}

async function sendToRecipient(
  campaignId: string,
  workspaceId: string,
  recipient: { id: string; wa_phone: string; variables: Record<string, string>; retry_count: number },
  template: Record<string, unknown>,
  cfg: typeof DEFAULTS,
  channel: WhatsAppChannelConfig,
) {
  const vars = recipient.variables || {};
  const templateVars = (template.variables as string[]) || [];
  const components = templateVars.length > 0
    ? [{ type: 'body', parameters: templateVars.map((variable) => ({ type: 'text', text: vars[variable] || '' })) }]
    : [];

  const payload = {
    messaging_product: 'whatsapp',
    to: recipient.wa_phone,
    type: 'template',
    template: {
      name: template.meta_template_name,
      language: { code: template.meta_template_language || 'pt_BR' },
      components,
    },
  };

  for (let attempt = 0; attempt <= cfg.max_retries; attempt++) {
    try {
      if (!channel.phone_number_id || !channel.access_token) {
        throw new Error('Canal WhatsApp do workspace não configurado.');
      }
      const response = await axios.post(`https://graph.facebook.com/v19.0/${channel.phone_number_id}/messages`, payload, {
        headers: { Authorization: `Bearer ${channel.access_token}` },
      });

      const metaMessageId = response.data.messages?.[0]?.id;
      await supabase
        .from('campaign_recipients')
        .update({
          status: 'sent',
          meta_message_id: metaMessageId,
          sent_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspaceId)
        .eq('id', recipient.id);

      await logDispatch(campaignId, workspaceId, recipient.id, 'sent', `Tentativa ${attempt + 1}`);
      return;
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: unknown } };
      const isLastAttempt = attempt === cfg.max_retries;

      if (isLastAttempt) {
        await supabase
          .from('campaign_recipients')
          .update({
            status: 'failed',
            error_message: JSON.stringify(axiosErr?.response?.data || 'Erro desconhecido'),
            retry_count: recipient.retry_count + attempt + 1,
          })
          .eq('workspace_id', workspaceId)
          .eq('id', recipient.id);

        await logDispatch(campaignId, workspaceId, recipient.id, 'failed', `Falhou apos ${attempt + 1} tentativas`);
      } else {
        await logDispatch(campaignId, workspaceId, recipient.id, 'retried', `Tentativa ${attempt + 1} falhou`);
        await sleep(cfg.retry_backoff_ms * (attempt + 1));
      }
    }
  }
}

async function syncAutomationRunForCampaign(
  campaignId: string,
  workspaceId: string,
  campaignStatus: string,
  counts?: CampaignCounts,
  completedAt?: string,
) {
  const effectiveCounts = counts || await getCampaignCounts(campaignId, workspaceId);
  const totalRecipients = effectiveCounts.pending + effectiveCounts.sent + effectiveCounts.delivered + effectiveCounts.read + effectiveCounts.failed;
  const successfulSends = effectiveCounts.sent + effectiveCounts.delivered + effectiveCounts.read;

  const payload: {
    status: 'running' | 'completed' | 'failed';
    total_recipients: number;
    sent_count: number;
    failed_count: number;
    completed_at?: string;
  } = {
    status: 'running',
    total_recipients: totalRecipients,
    sent_count: successfulSends,
    failed_count: effectiveCounts.failed,
  };

  if (campaignStatus === 'completed') {
    payload.status = 'completed';
    payload.completed_at = completedAt || new Date().toISOString();
  } else if (campaignStatus === 'failed') {
    payload.status = 'failed';
    payload.completed_at = completedAt || new Date().toISOString();
  }

  await supabase
    .from('automation_runs')
    .update(payload)
    .eq('workspace_id', workspaceId)
    .eq('campaign_id', campaignId);
}

async function getCampaignCounts(campaignId: string, workspaceId: string): Promise<CampaignCounts> {
  const [
    { count: pending },
    { count: sent },
    { count: delivered },
    { count: read },
    { count: failed },
  ] = await Promise.all([
    supabase.from('campaign_recipients').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('campaign_id', campaignId).eq('status', 'pending'),
    supabase.from('campaign_recipients').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('campaign_id', campaignId).eq('status', 'sent'),
    supabase.from('campaign_recipients').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('campaign_id', campaignId).eq('status', 'delivered'),
    supabase.from('campaign_recipients').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('campaign_id', campaignId).eq('status', 'read'),
    supabase.from('campaign_recipients').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('campaign_id', campaignId).eq('status', 'failed'),
  ]);

  return {
    pending: pending || 0,
    sent: sent || 0,
    delivered: delivered || 0,
    read: read || 0,
    failed: failed || 0,
  };
}

async function logDispatch(campaignId: string, workspaceId: string, recipientId: string, action: string, detail: string) {
  await supabase
    .from('campaign_dispatch_logs')
    .insert({ workspace_id: workspaceId, campaign_id: campaignId, recipient_id: recipientId, action, detail });
}

async function getWhatsAppChannelConfig(workspaceId: string): Promise<WhatsAppChannelConfig> {
  const { data } = await supabase
    .from('workspace_channels')
    .select('external_id, config, credentials')
    .eq('workspace_id', workspaceId)
    .eq('channel_type', 'whatsapp')
    .eq('provider', 'meta_cloud')
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    phone_number_id: String(
      data?.external_id ||
        (data?.config as Record<string, unknown> | null)?.phone_number_id ||
        process.env.META_PHONE_NUMBER_ID ||
        ''
    ).trim() || null,
    access_token: String(
      (data?.credentials as Record<string, unknown> | null)?.access_token ||
        process.env.META_ACCESS_TOKEN ||
        ''
    ).trim() || null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

startHealthServer();

function startHealthServer() {
  const port = Number(process.env.PORT) || 3005;
  const server = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        status: 'ok',
        service: 'campaign-worker',
        subscription: process.env.PUBSUB_SUBSCRIPTION_CAMPAIGN || null,
        ts: new Date().toISOString(),
      }));
      return;
    }

    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Not Found' }));
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Campaign Worker health server rodando na porta ${port}`);
  });
}

console.log('Campaign Worker aguardando jobs...');
