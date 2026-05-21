import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/authenticate';
import { writeAuditLog } from '../lib/auditLog';
import { listPrioritizedConnectors } from '../lib/integrationConnectorCatalog';
import { requireWorkspace } from '../lib/workspaceContext';
import { buildWebhookCallbackUrl, getWorkspaceWhatsAppChannel } from '../lib/channelResolver';
import {
  deleteWorkspaceChannel,
  getDefaultWorkspaceChannel,
  getWorkspaceChannelById,
  listWorkspaceChannels,
  updateWorkspaceChannelById,
  upsertWorkspaceLlmChannel,
  upsertWorkspaceChannel,
} from '../lib/workspaceChannels';
import { sendTransactionalEmail } from '../lib/emailSender';
import { rollupWorkspaceChannelStats } from '../lib/channelRollup';
import { supabase } from '../lib/supabase';
import {
  ensureChannelConfigMessages,
  readChannelMessagesConfig,
  validateChannelConfigMessages,
} from '../lib/channelConfigMessages';
import {
  intakePatchFromLegacyFlowMessages,
  mergeChannelMessagesConfig,
  serializeChannelMessagesForConfig,
} from '@plataforma/channel-runtime';
import { resolveGeminiApiKey } from '@plataforma/ai-core';
import {
  applyLlmDefaults,
  getLlmProviderDefinition,
  listLlmProvidersForApi,
  validateLlmPayload,
} from '../lib/llmProviderCatalog';
import { decryptLlmCredentialRecord } from '../lib/workspaceLlmCrypto';
import { resolveWorkspaceLlmFromStoredRow } from '../lib/workspaceLlmRuntime';
import { staffLlmPing } from '../lib/staffLlmInvoke';

function envOk(...keys: string[]): boolean {
  return keys.every((k) => Boolean(process.env[k]?.trim()));
}

function maskId(id: string | undefined): string | undefined {
  if (!id || id.length < 5) return undefined;
  return `…${id.slice(-4)}`;
}

function mergeLlmCredentialPatch(
  existingPlain: Record<string, unknown>,
  incoming?: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...existingPlain };
  if (!incoming) return out;
  for (const [key, val] of Object.entries(incoming)) {
    if (typeof val !== 'string') continue;
    if (val.startsWith('••••') || val === '') continue;
    out[key] = val;
  }
  return out;
}

async function loadDefaultWorkspaceLlmRow(workspaceId: string) {
  const { data } = await supabase
    .from('workspace_channels')
    .select('provider,credentials,config,is_active')
    .eq('workspace_id', workspaceId)
    .eq('channel_type', 'llm')
    .eq('external_id', 'default')
    .maybeSingle();
  return data;
}

async function validateWorkspaceLlmBeforeUpsert(args: {
  workspaceId: string;
  providerId: string;
  credentialsPatch?: Record<string, unknown>;
  configPatch?: Record<string, unknown>;
  willBeActive: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!args.willBeActive) return { ok: true };
  const row = await loadDefaultWorkspaceLlmRow(args.workspaceId);
  const prevProv = row ? String(row.provider || args.providerId) : args.providerId;
  const plainExisting = row ? decryptLlmCredentialRecord(prevProv, (row.credentials as Record<string, unknown>) || {}) : {};
  const mergedCred = mergeLlmCredentialPatch(plainExisting, args.credentialsPatch);
  const baseCfg = (row?.config as Record<string, unknown>) || {};
  const mergedCfg = applyLlmDefaults(args.providerId, { ...baseCfg, ...(args.configPatch || {}) });
  return validateLlmPayload(args.providerId, mergedCred, mergedCfg);
}

/** Mesmas variáveis usadas em messages/conversations (META_PHONE_NUMBER_ID) + aliases Cloud API. */
function whatsappCloudConfigured(): { ok: boolean; phoneId?: string } {
  const phoneId =
    process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim() ||
    process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ||
    process.env.META_PHONE_NUMBER_ID?.trim();
  const access =
    process.env.META_WHATSAPP_ACCESS_TOKEN?.trim() ||
    process.env.WHATSAPP_ACCESS_TOKEN?.trim() ||
    process.env.META_ACCESS_TOKEN?.trim();
  return { ok: Boolean(phoneId && access), phoneId };
}

function webhookPublicCallbackUrl(channelId?: string): string | null {
  return buildWebhookCallbackUrl(channelId) || null;
}

const registerWebhookBody = z.object({
  callback_url: z.string().url().optional(),
});

/**
 * Tenta registar o callback do webhook na Graph API (nível da aplicação Meta).
 * Requer token com permissões adequadas; se a Meta alterar o contrato, ajuste META_GRAPH_VERSION / META_WEBHOOK_SUBSCRIPTION_OBJECT.
 */
async function postMetaAppSubscription(args: {
  appId: string;
  appAccessToken: string;
  callbackUrl: string;
  verifyToken: string;
  objectName: string;
  fields: string;
}): Promise<{ status: number; body: unknown }> {
  const version = process.env.META_GRAPH_VERSION?.trim() || 'v21.0';
  const base = `https://graph.facebook.com/${version}/${args.appId}/subscriptions`;
  const url = `${base}?access_token=${encodeURIComponent(args.appAccessToken)}`;
  const form = new URLSearchParams();
  form.set('object', args.objectName);
  form.set('callback_url', args.callbackUrl);
  form.set('verify_token', args.verifyToken);
  form.set('fields', args.fields);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = { raw: await res.text() };
  }
  return { status: res.status, body };
}

export async function integrationsRoutes(app: FastifyInstance) {
  app.get('/connectors/priority', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (_request, reply) => {
    const prioritized = listPrioritizedConnectors();
    return reply.send({
      version: 'v1',
      method: 'demand(45%) + strategic(45%) - effort(25%)',
      items: prioritized,
    });
  });

  app.get('/llm-catalog', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (_request, reply) => {
    return reply.send({ items: listLlmProvidersForApi() });
  });

  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    const workspaceChannels = await listWorkspaceChannels(workspaceId).catch(() => []);
    const waChannel = await getDefaultWorkspaceChannel(workspaceId, 'whatsapp').catch(() => null);
    const igChannel = await getDefaultWorkspaceChannel(workspaceId, 'instagram').catch(() => null);
    const emailChannel = await getDefaultWorkspaceChannel(workspaceId, 'email').catch(() => null);
    const webchatChannel = await getDefaultWorkspaceChannel(workspaceId, 'webchat').catch(() => null);

    const waFromDb = waChannel?.provider === 'meta_cloud';
    const phoneId = String(
      waChannel?.external_id ||
        waChannel?.config?.phone_number_id ||
        process.env.META_WHATSAPP_PHONE_NUMBER_ID ||
        process.env.WHATSAPP_PHONE_NUMBER_ID ||
        process.env.META_PHONE_NUMBER_ID ||
        ''
    ).trim();
    const accessToken = String(
      waChannel?.credentials?.access_token ||
        process.env.META_WHATSAPP_ACCESS_TOKEN ||
        process.env.WHATSAPP_ACCESS_TOKEN ||
        process.env.META_ACCESS_TOKEN ||
        ''
    ).trim();
    const verifyToken = String(waChannel?.verify_token || process.env.META_VERIFY_TOKEN || '').trim();
    const waCloud = Boolean(phoneId && accessToken);

    const waWebhook = Boolean(verifyToken);
    const callbackUrl = webhookPublicCallbackUrl();

    let waHint: string;
    if (waCloud && waWebhook && callbackUrl) {
      waHint = waFromDb
        ? 'Canal WhatsApp do workspace configurado com Cloud API, verify token e URL pública do webhook.'
        : 'Cloud API, verify token e URL pública do webhook detetados. Pode usar “Registar na Meta” (admin) se META_APP_ID e token de app estiverem definidos.';
    } else if (waCloud && waWebhook) {
      waHint =
        'Cloud API e META_VERIFY_TOKEN OK. Defina WEBHOOK_PUBLIC_BASE_URL (URL pública do webhook-service, ex. ngrok) para a Meta conseguir validar o GET /webhook.';
    } else if (waCloud) {
      waHint =
        'Cloud API pronta. Configure META_VERIFY_TOKEN no webhook-service e WEBHOOK_PUBLIC_BASE_URL para o callback.';
    } else if (waWebhook) {
      waHint = 'META_VERIFY_TOKEN presente; faltam ID do número e token de acesso da Cloud API na API.';
    } else {
      waHint =
        'Defina um canal do workspace ou configure META_PHONE_NUMBER_ID, META_ACCESS_TOKEN, META_VERIFY_TOKEN e WEBHOOK_PUBLIC_BASE_URL.';
    }

    const waDetails: string[] = [];
    if (phoneId) {
      const m = maskId(phoneId);
      waDetails.push(m ? `Phone number ID ${m}` : 'Phone number ID definido');
    }
    if (waCloud) waDetails.push('Access token definido');
    if (verifyToken) waDetails.push('Verify token definido');
    if (callbackUrl) waDetails.push(`Callback sugerido: ${callbackUrl}`);

    const instagramConfigured = Boolean(igChannel) || envOk('META_INSTAGRAM_USER_ID', 'META_INSTAGRAM_ACCESS_TOKEN');
    const emailConfigured = Boolean(emailChannel) || envOk('SMTP_HOST', 'SMTP_USER', 'SMTP_PASS');
    const webchatConfigured = Boolean(webchatChannel) || envOk('NEXT_PUBLIC_WEBCHAT_SITE_KEY') || envOk('WEBCHAT_EMBED_SECRET');

    const appId = process.env.META_APP_ID?.trim();
    const graphAppToken =
      process.env.META_GRAPH_APP_ACCESS_TOKEN?.trim() || process.env.META_APP_ACCESS_TOKEN?.trim();

    const { data: llmRow } = await supabase
      .from('workspace_channels')
      .select('id, is_active, provider, credentials')
      .eq('workspace_id', workspaceId)
      .eq('channel_type', 'llm')
      .eq('external_id', 'default')
      .maybeSingle();

    const llmProvId = llmRow?.provider ? String(llmRow.provider) : '';
    const llmDef = llmProvId ? getLlmProviderDefinition(llmProvId) : undefined;
    const secretKeys =
      llmDef?.credentialFields.filter((f) => f.kind === 'secret').map((f) => f.key) ?? ['api_key'];
    const creds = (llmRow?.credentials as Record<string, unknown>) || {};
    const workspaceLlmSecretsSaved = secretKeys.some((k) => typeof creds[k] === 'string' && String(creds[k]).length > 0);

    const envGeminiKey = Boolean(resolveGeminiApiKey());
    const llmHint =
      workspaceLlmSecretsSaved && llmRow?.is_active
        ? `Provedor ${llmDef?.name || llmProvId} ativo neste workspace (BYOK).`
        : workspaceLlmSecretsSaved && !llmRow?.is_active
          ? 'Credenciais guardadas mas canal inativo — pode haver fallback por ambiente (ex.: Gemini via GOOGLE_API_KEY).'
          : envGeminiKey
            ? 'Sem BYOK completo neste workspace: em uso fallback Gemini do servidor se o runtime permitir.'
            : 'Configure o canal IA / LLM em Configurações → Canais (provedor e credenciais).';

    return reply.send({
      workspace_id: workspaceId,
      workspace_llm: {
        workspace_channel_id: llmRow?.id || null,
        provider: llmProvId || null,
        provider_name: llmDef?.name || null,
        workspace_credentials_saved: workspaceLlmSecretsSaved,
        active: Boolean(llmRow?.is_active),
        env_gemini_fallback_available: envGeminiKey,
        hint: llmHint,
      },
      whatsapp: {
        configured: waCloud,
        webhook_ready: waWebhook,
        fully_ready: waCloud && waWebhook && Boolean(callbackUrl),
        callback_url: callbackUrl,
        hint: waHint,
        details: waDetails,
        meta_app_webhook_supported: Boolean(appId && graphAppToken && callbackUrl && verifyToken),
        channel_id: waChannel?.id || null,
        source: waChannel ? 'workspace' : 'environment',
      },
      instagram: {
        configured: instagramConfigured,
        hint: instagramConfigured
          ? igChannel
            ? 'Canal Instagram configurado para este workspace'
            : 'Variáveis Instagram detetadas'
          : 'Configure META_INSTAGRAM_USER_ID e META_INSTAGRAM_ACCESS_TOKEN quando disponível',
      },
      email: {
        configured: emailConfigured,
        hint: emailConfigured
          ? emailChannel
            ? 'Canal de e-mail configurado para este workspace'
            : 'SMTP detetado no servidor'
          : 'Configure SMTP_HOST, SMTP_USER e SMTP_PASS',
      },
      webchat: {
        configured: webchatConfigured,
        hint: webchatConfigured
          ? webchatChannel
            ? 'Canal de webchat configurado para este workspace'
            : 'Webchat/embed detetado'
          : 'Opcional: NEXT_PUBLIC_WEBCHAT_SITE_KEY ou WEBCHAT_EMBED_SECRET',
      },
      channels: workspaceChannels,
    });
  });

  app.put(
    '/channels/by-type/:channelType',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const channelType = String((request.params as { channelType: string }).channelType || '').trim();

      if (channelType === 'llm') {
        const body = z
          .object({
            provider: z.string().min(2).max(80),
            display_name: z.string().min(2).max(120).optional(),
            config: z.record(z.unknown()).optional(),
            credentials: z.record(z.unknown()).optional(),
            is_active: z.boolean().optional(),
          })
          .safeParse(request.body ?? {});

        if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

        if (!getLlmProviderDefinition(body.data.provider)) {
          return reply.status(400).send({ error: 'Provedor LLM não suportado.' });
        }

        const existing = await loadDefaultWorkspaceLlmRow(workspaceId);
        const willBeActive = body.data.is_active ?? existing?.is_active ?? true;

        const check = await validateWorkspaceLlmBeforeUpsert({
          workspaceId,
          providerId: body.data.provider,
          credentialsPatch: body.data.credentials,
          configPatch: body.data.config as Record<string, unknown> | undefined,
          willBeActive,
        });
        if (!check.ok) return reply.status(400).send({ error: check.error });

        const saved = await upsertWorkspaceLlmChannel(workspaceId, {
          provider: body.data.provider,
          credentials: body.data.credentials,
          config: body.data.config as Record<string, unknown> | undefined,
          is_active: body.data.is_active,
          display_name: body.data.display_name ?? null,
        });

        await writeAuditLog({
          actor_id: (request.user as { sub: string }).sub,
          action: 'integrations.llm.upsert',
          entity_type: 'workspace_channel',
          entity_id: saved.id,
          metadata: { workspace_id: workspaceId, channel_type: saved.channel_type, provider: saved.provider },
        });

        return reply.send(saved);
      }

      if (!['whatsapp', 'instagram', 'email', 'webchat'].includes(channelType)) {
        return reply.status(400).send({ error: 'Tipo de canal inválido.' });
      }

      const body = z
        .object({
          provider: z.string().min(2),
          display_name: z.string().min(2).max(120).optional(),
          external_id: z.string().min(2).optional().nullable(),
          verify_token: z.string().min(2).optional().nullable(),
          config: z.record(z.unknown()).optional(),
          credentials: z.record(z.unknown()).optional(),
          is_active: z.boolean().optional(),
          is_default: z.boolean().optional(),
        })
        .safeParse(request.body ?? {});

      if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

      const saved = await upsertWorkspaceChannel({
        workspace_id: workspaceId,
        channel_type: channelType as 'whatsapp' | 'instagram' | 'email' | 'webchat',
        provider: body.data.provider,
        display_name: body.data.display_name,
        external_id: body.data.external_id ?? null,
        verify_token: body.data.verify_token ?? null,
        config: body.data.config || {},
        credentials: body.data.credentials || {},
        is_active: body.data.is_active ?? true,
        is_default: body.data.is_default ?? false,
      });

      await writeAuditLog({
        actor_id: (request.user as { sub: string }).sub,
        action: 'integrations.channel.upsert',
        entity_type: 'workspace_channel',
        entity_id: saved.id,
        metadata: { workspace_id: workspaceId, channel_type: saved.channel_type, provider: saved.provider },
      });

      return reply.send(saved);
    }
  );

  app.post(
    '/whatsapp/register-meta-webhook',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const parsed = registerWebhookBody.safeParse(request.body ?? {});
      if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

      const waChannel = await getDefaultWorkspaceChannel(workspaceId, 'whatsapp').catch(() => null);
      const appId = process.env.META_APP_ID?.trim();
      const appAccessToken =
        process.env.META_GRAPH_APP_ACCESS_TOKEN?.trim() || process.env.META_APP_ACCESS_TOKEN?.trim();
      const verify = String(waChannel?.verify_token || process.env.META_VERIFY_TOKEN || '').trim();
      const defaultCallback = webhookPublicCallbackUrl();
      const callbackUrl = (parsed.data.callback_url || defaultCallback)?.trim();

      if (!appId || !appAccessToken || !verify || !callbackUrl) {
        return reply.status(422).send({
          error: 'Configuração incompleta',
          required: [
            'META_APP_ID',
            'META_GRAPH_APP_ACCESS_TOKEN (ou META_APP_ACCESS_TOKEN)',
            'META_VERIFY_TOKEN',
            'WEBHOOK_PUBLIC_BASE_URL ou callback_url no body',
          ],
        });
      }

      const objectName = process.env.META_WEBHOOK_SUBSCRIPTION_OBJECT?.trim() || 'whatsapp_business_account';
      const fields =
        process.env.META_WEBHOOK_SUBSCRIPTION_FIELDS?.trim() ||
        'messages,message_template_status_update';

      const result = await postMetaAppSubscription({
        appId,
        appAccessToken,
        callbackUrl,
        verifyToken: verify,
        objectName,
        fields,
      });

      const actor = (request.user as { sub: string }).sub;
      await writeAuditLog({
        actor_id: actor,
        action: 'integrations.meta_webhook_register',
        entity_type: 'meta_webhook',
        metadata: { status: result.status, object: objectName, workspace_id: workspaceId },
      });

      if (result.status >= 400) {
        return reply.status(502).send({
          error: 'A Meta devolveu erro ao registar o webhook',
          graph: result.body,
        });
      }

      return reply.send({ ok: true, graph: result.body, callback_url: callbackUrl });
    }
  );

  // Leitura liberada para atendentes (inbox, contexto operacional); credenciais já vêm mascaradas em listWorkspaceChannels.
  app.get('/channels', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const channels = await listWorkspaceChannels(workspaceId);
    return reply.send({ items: channels });
  });

  app.get('/channels/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const id = String((request.params as { id: string }).id);
    const channel = await getWorkspaceChannelById(workspaceId, id);
    if (!channel) return reply.status(404).send({ error: 'Canal não encontrado.' });
    return reply.send(channel);
  });

  app.post('/channels', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = z
      .object({
        channel_type: z.enum(['whatsapp', 'instagram', 'email', 'webchat', 'llm']),
        provider: z.string().min(2),
        display_name: z.string().min(2).max(120).optional(),
        external_id: z.string().min(2).optional().nullable(),
        verify_token: z.string().min(2).optional().nullable(),
        config: z.record(z.unknown()).optional(),
        credentials: z.record(z.unknown()).optional(),
        is_active: z.boolean().optional(),
        is_default: z.boolean().optional(),
        status: z.enum(['active', 'paused', 'error', 'draft']).optional(),
      })
      .safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    if (body.data.channel_type === 'llm') {
      if (!getLlmProviderDefinition(body.data.provider)) {
        return reply.status(400).send({ error: 'Provedor LLM não suportado.' });
      }
      const existing = await loadDefaultWorkspaceLlmRow(workspaceId);
      const willBeActive = body.data.is_active ?? existing?.is_active ?? true;
      const check = await validateWorkspaceLlmBeforeUpsert({
        workspaceId,
        providerId: body.data.provider,
        credentialsPatch: body.data.credentials || {},
        configPatch: body.data.config || {},
        willBeActive,
      });
      if (!check.ok) return reply.status(400).send({ error: check.error });

      const saved = await upsertWorkspaceLlmChannel(workspaceId, {
        provider: body.data.provider,
        credentials: body.data.credentials || {},
        config: body.data.config || {},
        is_active: body.data.is_active ?? true,
        display_name: body.data.display_name ?? null,
      });

      await writeAuditLog({
        actor_id: (request.user as { sub: string }).sub,
        action: 'integrations.channel.create',
        entity_type: 'workspace_channel',
        entity_id: saved.id,
        metadata: { workspace_id: workspaceId, channel_type: saved.channel_type, provider: saved.provider },
      });

      return reply.status(201).send(saved);
    }

    const verifyToken = body.data.verify_token?.trim() || crypto.randomBytes(18).toString('hex');

    const saved = await upsertWorkspaceChannel({
      workspace_id: workspaceId,
      channel_type: body.data.channel_type,
      provider: body.data.provider,
      display_name: body.data.display_name,
      external_id: body.data.external_id ?? null,
      verify_token: verifyToken,
      config: body.data.config || {},
      credentials: body.data.credentials || {},
      is_active: body.data.is_active ?? true,
      is_default: body.data.is_default ?? false,
      status: body.data.status ?? 'draft',
    });

    await writeAuditLog({
      actor_id: (request.user as { sub: string }).sub,
      action: 'integrations.channel.create',
      entity_type: 'workspace_channel',
      entity_id: saved.id,
      metadata: { workspace_id: workspaceId, channel_type: saved.channel_type },
    });

    return reply.status(201).send({ ...saved, webhook_callback_url: webhookPublicCallbackUrl(saved.id) });
  });

  app.put('/channels/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const id = String((request.params as { id: string }).id);
    const existing = await getWorkspaceChannelById(workspaceId, id);
    if (!existing) return reply.status(404).send({ error: 'Canal não encontrado.' });

    const body = z
      .object({
        provider: z.string().min(2).optional(),
        display_name: z.string().min(2).max(120).optional(),
        external_id: z.string().min(2).optional().nullable(),
        verify_token: z.string().min(2).optional().nullable(),
        config: z.record(z.unknown()).optional(),
        credentials: z.record(z.unknown()).optional(),
        is_active: z.boolean().optional(),
        is_default: z.boolean().optional(),
        status: z.enum(['active', 'paused', 'error', 'draft']).optional(),
      })
      .safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const saved = await updateWorkspaceChannelById(workspaceId, id, {
      provider: body.data.provider,
      display_name: body.data.display_name,
      external_id: body.data.external_id,
      verify_token: body.data.verify_token,
      config: body.data.config,
      credentials: body.data.credentials,
      is_active: body.data.is_active,
      is_default: body.data.is_default,
      status: body.data.status,
    });

    return reply.send({ ...saved, webhook_callback_url: webhookPublicCallbackUrl(saved.id) });
  });

  app.get('/channels/:id/messages/validate', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const id = String((request.params as { id: string }).id);
    const channel = await getWorkspaceChannelById(workspaceId, id);
    if (!channel) return reply.status(404).send({ error: 'Canal não encontrado.' });
    if (channel.channel_type !== 'whatsapp' && channel.channel_type !== 'instagram') {
      return reply.status(400).send({ error: 'Validação de mensagens aplica-se a canais de mensageria.' });
    }
    const validation = validateChannelConfigMessages(channel.config as Record<string, unknown>);
    const messages = readChannelMessagesConfig(channel.config as Record<string, unknown>);
    return reply.send({ ...validation, messages });
  });

  app.post(
    '/channels/:id/messages/migrate-from-workspace',
    { preHandler: [authenticate, requireRole('admin')] },
    async (request, reply) => {
      const workspaceId = await requireWorkspace(request, reply);
      if (!workspaceId) return;
      const id = String((request.params as { id: string }).id);
      const channel = await getWorkspaceChannelById(workspaceId, id);
      if (!channel) return reply.status(404).send({ error: 'Canal não encontrado.' });
      if (channel.channel_type !== 'whatsapp' && channel.channel_type !== 'instagram') {
        return reply.status(400).send({ error: 'Migração aplica-se a canais de mensageria.' });
      }

      const { data: flowRows, error: flowErr } = await supabase
        .from('workspace_flow_messages')
        .select('message_key, content')
        .eq('workspace_id', workspaceId)
        .eq('is_active', true);
      if (flowErr) return reply.status(500).send({ error: flowErr.message });

      const current = readChannelMessagesConfig(channel.config as Record<string, unknown>);
      const patch = intakePatchFromLegacyFlowMessages(
        (flowRows || []) as Array<{ message_key: string; content: string }>
      );
      const merged = mergeChannelMessagesConfig({ ...current, intake: { ...current.intake, ...patch } });
      const nextConfig = ensureChannelConfigMessages({
        ...(channel.config as Record<string, unknown>),
        messages: serializeChannelMessagesForConfig(merged),
      });

      const saved = await updateWorkspaceChannelById(workspaceId, id, { config: nextConfig });
      return reply.send({
        ok: true,
        migrated_keys: Object.keys(patch),
        channel: saved,
        validation: validateChannelConfigMessages(nextConfig),
      });
    }
  );

  app.post('/channels/:id/register-meta-webhook', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const id = String((request.params as { id: string }).id);
    const channel = await getWorkspaceChannelById(workspaceId, id);
    if (!channel || channel.channel_type !== 'whatsapp') {
      return reply.status(404).send({ error: 'Canal WhatsApp não encontrado.' });
    }

    const parsed = registerWebhookBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const appId = process.env.META_APP_ID?.trim();
    const appAccessToken =
      process.env.META_GRAPH_APP_ACCESS_TOKEN?.trim() || process.env.META_APP_ACCESS_TOKEN?.trim();
    const verify = String(channel.verify_token || process.env.META_VERIFY_TOKEN || '').trim();
    const defaultCallback = webhookPublicCallbackUrl(channel.id);
    const callbackUrl = (parsed.data.callback_url || defaultCallback)?.trim();

    if (!appId || !appAccessToken || !verify || !callbackUrl) {
      return reply.status(422).send({ error: 'Configuração incompleta para registar webhook na Meta.' });
    }

    const objectName = process.env.META_WEBHOOK_SUBSCRIPTION_OBJECT?.trim() || 'whatsapp_business_account';
    const fields =
      process.env.META_WEBHOOK_SUBSCRIPTION_FIELDS?.trim() ||
      'messages,message_template_status_update';

    const result = await postMetaAppSubscription({
      appId,
      appAccessToken,
      callbackUrl,
      verifyToken: verify,
      objectName,
      fields,
    });

    if (result.status >= 400) {
      return reply.status(502).send({ error: 'A Meta devolveu erro ao registar o webhook', graph: result.body });
    }

    return reply.send({ ok: true, graph: result.body, callback_url: callbackUrl });
  });

  app.delete('/channels/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const id = String((request.params as { id: string }).id);
    await deleteWorkspaceChannel(workspaceId, id);
    return reply.status(204).send();
  });

  app.post('/channels/:id/test-connection', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const id = String((request.params as { id: string }).id);
    const channel = await getWorkspaceChannelById(workspaceId, id);
    if (!channel) return reply.status(404).send({ error: 'Canal não encontrado.' });

    if (channel.channel_type === 'whatsapp') {
      const resolved = await getWorkspaceWhatsAppChannel(workspaceId, channel.external_id);
      const phoneId = String(resolved?.external_id || '').trim();
      const token = String(resolved?.credentials?.access_token || '').trim();
      if (!phoneId || !token) {
        return reply.status(422).send({ ok: false, error: 'Credenciais WhatsApp incompletas.' });
      }
      const version = process.env.META_GRAPH_VERSION?.trim() || 'v21.0';
      const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}?fields=display_phone_number,verified_name`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const graph = await res.json().catch(() => ({}));
      if (!res.ok) return reply.status(502).send({ ok: false, graph });
      return reply.send({ ok: true, graph });
    }

    if (channel.channel_type === 'email') {
      const to = String((request.body as { to?: string })?.to || (request.user as { email?: string }).email || '').trim();
      if (!to) return reply.status(400).send({ error: 'Informe o e-mail de destino no body { to }.' });
      try {
        await sendTransactionalEmail({
          to,
          subject: 'Teste de conexão SMTP',
          html: '<p>Conexão de e-mail do workspace validada.</p>',
          workspaceId,
          templateKey: 'channel_test',
          channelId: id,
          useChannelOnly: true,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Falha ao enviar e-mail de teste';
        return reply.status(422).send({ ok: false, error: msg });
      }
      return reply.send({ ok: true });
    }

    if (channel.channel_type === 'llm') {
      if (String(channel.external_id || '') !== 'default') {
        return reply.status(400).send({ ok: false, error: 'Use o canal LLM principal (external_id default) para testar.' });
      }
      const { data: rawRow } = await supabase
        .from('workspace_channels')
        .select('provider,credentials,config')
        .eq('workspace_id', workspaceId)
        .eq('id', id)
        .maybeSingle();
      if (!rawRow) return reply.status(404).send({ ok: false, error: 'Canal não encontrado.' });

      const runtime = resolveWorkspaceLlmFromStoredRow(rawRow);
      if (!runtime?.ok) {
        return reply.status(422).send({ ok: false, error: 'Credenciais ou configuração LLM incompletas para este canal.' });
      }
      try {
        await staffLlmPing(runtime);
      } catch (e) {
        return reply.status(502).send({
          ok: false,
          error: e instanceof Error ? e.message : 'Falha ao contactar o provedor LLM.',
        });
      }
      return reply.send({ ok: true, provider: runtime.providerId, model: runtime.models[0] || null });
    }

    return reply.status(400).send({ error: 'Teste de conexão não suportado para este tipo de canal.' });
  });

  app.post('/channels/rollup-stats', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    try {
      const result = await rollupWorkspaceChannelStats(workspaceId);
      return reply.send(result);
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Falha no rollup de canais' });
    }
  });
}
