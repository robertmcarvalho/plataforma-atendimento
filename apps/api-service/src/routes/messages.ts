import { FastifyInstance, FastifyRequest } from 'fastify';
import type { Multipart } from '@fastify/multipart';
import { createLogger } from '@plataforma/logger';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate } from '../middleware/authenticate';
import { getWorkspaceChannelById, getWorkspaceWhatsAppChannel } from '../lib/channelResolver';
import { requireWorkspace } from '../lib/workspaceContext';
import { markConversationFirstResponseIfNeeded } from '../lib/conversationSla';
import { resolveTemplateBody } from '@plataforma/operational-notes';
import { normalizeEmptyTemplatePlaceholders, resolveTemplateVariableKeys } from '../lib/metaTemplateSync';
import { detectMessageTypeFromMime, resolveOutboundUploadMime } from '@plataforma/channel-runtime';
import { prepareOutboundMediaForMeta } from '../lib/prepareOutboundMedia';
import { uploadWhatsAppMediaToMeta } from '../lib/metaMediaUpload';
import { uploadOutboundMessageMedia } from '../lib/messageMediaStorage';
import { triggerCommercialLeadScoring } from '../lib/commercial/leadScoringTrigger';

const uploadLogger = createLogger('messages.upload');

const sendMessageSchema = z.object({
  conversation_id: z.string().uuid(),
  workspace_channel_id: z.string().uuid().optional(),
  type: z.enum(['text', 'template', 'contact']).default('text'),
  content: z.string().optional(),
  template_id: z.string().uuid().optional(),
  template_variables: z.record(z.string()).optional(),
  signature: z.string().optional(),
  contact_name: z.string().optional(),
  contact_phone: z.string().optional(),
});

type StoredConversation = {
  id: string;
  workspace_id: string;
  workspace_channel_id: string | null;
  contacts: { wa_phone: string } | null;
};

type MessageRow = {
  workspace_id: string;
  conversation_id: string;
  meta_message_id?: string | null;
  direction: 'inbound' | 'outbound';
  type: string;
  content?: string | null;
  media_url?: string | null;
  template_id?: string | null;
  status: string;
  sent_at: string;
};

type WhatsAppChannelConfig = {
  workspace_id: string;
  phone_number_id: string | null;
  access_token: string | null;
};

function toWhatsAppChannelConfig(workspaceId: string, channel: Awaited<ReturnType<typeof getWorkspaceChannelById>>): WhatsAppChannelConfig {
  return {
    workspace_id: workspaceId,
    phone_number_id: String(channel?.external_id || channel?.credentials?.phone_number_id || '').trim() || null,
    access_token: String(channel?.credentials?.access_token || process.env.META_ACCESS_TOKEN || '').trim() || null,
  };
}

async function resolveWhatsAppConfig(workspaceId: string): Promise<WhatsAppChannelConfig> {
  const channel = await getWorkspaceWhatsAppChannel(workspaceId);
  return toWhatsAppChannelConfig(workspaceId, channel);
}

async function resolveWhatsAppConfigForConversation(
  workspaceId: string,
  workspaceChannelId: string | null | undefined
): Promise<WhatsAppChannelConfig> {
  const channelId = String(workspaceChannelId || '').trim();
  if (channelId) {
    const byConversation = await getWorkspaceChannelById(channelId);
    if (byConversation) return toWhatsAppChannelConfig(workspaceId, byConversation);
  }
  return resolveWhatsAppConfig(workspaceId);
}

type StoredContact = { wa_phone: string; leader_id?: string | null; commercial_lead_id?: string | null };

async function getConversation(
  conversationId: string,
  workspaceId: string
): Promise<(StoredConversation & { context_commercial_lead_id?: string | null; contacts: StoredContact | null }) | null> {
  const { data } = await supabase
    .from('conversations')
    .select('id, workspace_id, workspace_channel_id, context_commercial_lead_id, contacts(wa_phone, leader_id, commercial_lead_id)')
    .eq('id', conversationId)
    .eq('workspace_id', workspaceId)
    .single();

  if (!data) return null;

  const contacts = Array.isArray(data.contacts) ? data.contacts[0] : data.contacts;

  return {
    id: data.id,
    workspace_id: String(data.workspace_id),
    workspace_channel_id: data.workspace_channel_id ? String(data.workspace_channel_id) : null,
    context_commercial_lead_id: data.context_commercial_lead_id ? String(data.context_commercial_lead_id) : null,
    contacts: contacts as StoredContact | null,
  };
}

async function resolveOutboundWorkspaceChannelId(
  workspaceId: string,
  conversation: Awaited<ReturnType<typeof getConversation>>,
  requestedWorkspaceChannelId?: string,
  template?: { category?: string | null; meta_template_name?: string | null } | null
): Promise<string | null | undefined> {
  if (template) {
    const { isCommercialMessageTemplate, resolveCommercialWhatsAppChannel } = await import(
      '../lib/commercial/commercialChannel'
    );
    if (isCommercialMessageTemplate(template)) {
      return resolveCommercialWhatsAppChannel(workspaceId);
    }
  }
  if (requestedWorkspaceChannelId) return requestedWorkspaceChannelId;
  if (conversation?.workspace_channel_id) return conversation.workspace_channel_id;
  const isCommercial =
    Boolean(conversation?.context_commercial_lead_id) ||
    Boolean(conversation?.contacts?.commercial_lead_id);
  if (!isCommercial) return null;
  const { resolveCommercialWhatsAppChannel } = await import('../lib/commercial/commercialChannel');
  return resolveCommercialWhatsAppChannel(workspaceId);
}

async function assertLeaderOwnsConversation(
  userId: string,
  workspaceId: string,
  conversation: StoredConversation & { contacts: StoredContact | null }
) {
  const leaderId = conversation.contacts?.leader_id;
  if (!leaderId) {
    throw Object.assign(new Error('Conversa não pertence ao portal do líder.'), { statusCode: 403 });
  }
  const { data: leader } = await supabase
    .from('leaders')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('id', leaderId)
    .maybeSingle();
  if (!leader?.id) {
    throw Object.assign(new Error('Acesso negado a esta conversa.'), { statusCode: 403 });
  }
}

function metaApiErrorMessage(detail: unknown, fallback: string): string {
  const message = (detail as { error?: { message?: string } } | null)?.error?.message;
  return message?.trim() || fallback;
}

async function lastInboundWithin24h(workspaceId: string, conversationId: string): Promise<boolean> {
  const { data } = await supabase
    .from('messages')
    .select('created_at')
    .eq('workspace_id', workspaceId)
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.created_at) return false;
  return Date.now() - new Date(data.created_at).getTime() < 24 * 3_600_000;
}

async function sendWhatsAppJson(payload: object, channel: WhatsAppChannelConfig) {
  if (!channel.access_token || !channel.phone_number_id) {
    throw new Error('Meta WhatsApp nao configurado (META_ACCESS_TOKEN/META_PHONE_NUMBER_ID).');
  }
  const url = `https://graph.facebook.com/v19.0/${channel.phone_number_id}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${channel.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw { status: response.status, detail };
  }

  return response.json() as Promise<{ messages?: Array<{ id?: string }> }>;
}

async function persistMessage(
  row: MessageRow,
  options?: { humanHandoff?: boolean; attendantId?: string | null; commercialLeadId?: string | null },
) {
  const { data, error } = await supabase.from('messages').insert(row).select().single();
  if (error) throw new Error(error.message);

  const convPatch: Record<string, unknown> = {
    last_message_at: row.sent_at || new Date().toISOString(),
    status: 'open',
    has_unread: row.direction === 'inbound',
  };

  if (row.direction === 'outbound') {
    convPatch.has_unread = false;
    if (options?.humanHandoff) {
      convPatch.human_handoff_at = row.sent_at || new Date().toISOString();
      if (options.attendantId) convPatch.attendant_id = options.attendantId;
    }
  }

  await supabase
    .from('conversations')
    .update(convPatch)
    .eq('workspace_id', row.workspace_id)
    .eq('id', row.conversation_id);

  if (row.direction === 'outbound') {
    await markConversationFirstResponseIfNeeded(row.conversation_id, new Date(row.sent_at));
    if (options?.commercialLeadId) {
      triggerCommercialLeadScoring({
        workspaceId: row.workspace_id,
        leadId: options.commercialLeadId,
        reason: 'message_received',
      });
    }
  }

  return data;
}

function withSignature(content?: string, signature?: string) {
  const body = (content || '').trim();
  const signed = (signature || '').trim();
  if (!signed) return body;
  return body ? `${signed}:\n${body}` : signed;
}

function detectMessageType(mimeType: string) {
  return detectMessageTypeFromMime(mimeType);
}

type ParsedMultipartUpload = {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  fields: Record<string, string>;
};

async function parseMultipartUpload(request: FastifyRequest): Promise<ParsedMultipartUpload> {
  const fields: Record<string, string> = {};
  let fileName = 'arquivo';
  let mimeType = 'application/octet-stream';
  let buffer: Buffer | null = null;

  const parts = request.parts() as AsyncIterable<Multipart>;
  for await (const part of parts) {
    if (part.type === 'file') {
      // O stream do arquivo precisa ser consumido durante a iteração — senão o parser trava.
      const chunk = await part.toBuffer();
      if (!buffer) {
        buffer = chunk;
        fileName = part.filename || fileName;
        mimeType = part.mimetype || mimeType;
      }
      continue;
    }
    fields[part.fieldname] = String(part.value ?? '').trim();
  }

  if (!buffer) throw Object.assign(new Error('Arquivo obrigatorio'), { statusCode: 400 });
  return { fileName, mimeType, buffer, fields };
}

export async function messageRoutes(app: FastifyInstance) {
  app.post('/send', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = sendMessageSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados invalidos', details: body.error.flatten() });

    const {
      conversation_id,
      workspace_channel_id: requestedWorkspaceChannelId,
      type,
      content,
      template_id,
      template_variables,
      signature,
      contact_name,
      contact_phone,
    } = body.data;
    const conversation = await getConversation(conversation_id, workspaceId);
    if (!conversation?.contacts?.wa_phone) return reply.status(404).send({ error: 'Conversa nao encontrada' });

    const user = request.user as { sub: string; role: string };
    const isLeader = String(user.role || '').toLowerCase() === 'leader';
    const staffPersistOpts = isLeader ? undefined : {
      humanHandoff: true as const,
      attendantId: user.sub,
      commercialLeadId: conversation.context_commercial_lead_id ?? null,
    };

    if (isLeader) {
      try {
        await assertLeaderOwnsConversation(user.sub, workspaceId, conversation);
      } catch (e) {
        const err = e as Error & { statusCode?: number };
        return reply.status(err.statusCode || 403).send({ error: err.message });
      }
      if (type !== 'text') {
        return reply.status(400).send({ error: 'Líder pode enviar apenas mensagens de texto pelo portal.' });
      }
      const textBody = (content || '').trim();
      if (!textBody) return reply.status(400).send({ error: 'Mensagem vazia.' });
      const message = await persistMessage({
        workspace_id: workspaceId,
        conversation_id,
        meta_message_id: null,
        direction: 'inbound',
        type: 'text',
        content: textBody,
        status: 'sent',
        sent_at: new Date().toISOString(),
      });
      await supabase
        .from('conversations')
        .update({ has_unread: true, last_message_at: new Date().toISOString() })
        .eq('id', conversation_id);
      return reply.status(201).send(message);
    }

    const to = conversation.contacts.wa_phone;

    let templateForChannel: { category?: string | null; meta_template_name?: string | null } | null = null;
    if (type === 'template' && template_id) {
      const { data: earlyTemplate } = await supabase
        .from('message_templates')
        .select('category, meta_template_name')
        .eq('workspace_id', workspaceId)
        .eq('id', template_id)
        .maybeSingle();
      templateForChannel = earlyTemplate;
    }

    let effectiveWorkspaceChannelId: string | null | undefined;
    try {
      effectiveWorkspaceChannelId = await resolveOutboundWorkspaceChannelId(
        workspaceId,
        conversation,
        requestedWorkspaceChannelId,
        templateForChannel
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Canal WhatsApp comercial não configurado.';
      return reply.status(400).send({ error: message });
    }
    const channel = await resolveWhatsAppConfigForConversation(workspaceId, effectiveWorkspaceChannelId);
    if (
      effectiveWorkspaceChannelId &&
      effectiveWorkspaceChannelId !== conversation.workspace_channel_id
    ) {
      await supabase
        .from('conversations')
        .update({ workspace_channel_id: effectiveWorkspaceChannelId, updated_at: new Date().toISOString() })
        .eq('workspace_id', workspaceId)
        .eq('id', conversation_id);
    }
    const metaEnabled = Boolean(channel.access_token && channel.phone_number_id);

    try {
      // Dev-friendly fallback: quando a integraÃ§Ã£o Meta nÃ£o estÃ¡ configurada, persiste a mensagem e retorna 201.
      // Isso permite validar UI e fluxos internos sem WhatsApp Cloud API.
      if (!metaEnabled) {
        if (type === 'template' && template_id) {
          const { data: template } = await supabase
            .from('message_templates')
            .select('*')
            .eq('workspace_id', workspaceId)
            .eq('id', template_id)
            .single();

          if (!template) return reply.status(404).send({ error: 'Template nao encontrado' });

          const variableKeys = resolveTemplateVariableKeys(template);
          const resolvedBody = resolveTemplateBody(
            normalizeEmptyTemplatePlaceholders(String(template.body || '')),
            variableKeys,
            template_variables,
          );

          const message = await persistMessage(
          {
            workspace_id: workspaceId,
            conversation_id,
            meta_message_id: null,
            direction: 'outbound',
            type: 'template',
            content: resolvedBody,
            template_id,
            status: 'sent',
            sent_at: new Date().toISOString(),
          },
          staffPersistOpts
        );

          return reply.status(201).send(message);
        }

        if (type === 'contact') {
          if (!contact_name || !contact_phone) {
            return reply.status(400).send({ error: 'Nome e telefone do contato sao obrigatorios' });
          }

          const message = await persistMessage(
            {
              workspace_id: workspaceId,
              conversation_id,
              meta_message_id: null,
              direction: 'outbound',
              type: 'contact',
              content: JSON.stringify({ name: contact_name, phone: contact_phone }),
              status: 'sent',
              sent_at: new Date().toISOString(),
            },
            staffPersistOpts
          );

          return reply.status(201).send(message);
        }

        const textBody = withSignature(content, signature);
        const message = await persistMessage(
          {
            workspace_id: workspaceId,
            conversation_id,
            meta_message_id: null,
            direction: 'outbound',
            type: 'text',
            content: textBody,
            status: 'sent',
            sent_at: new Date().toISOString(),
          },
          staffPersistOpts
        );

        return reply.status(201).send(message);
      }

      if (type === 'template' && template_id) {
        const { data: template } = await supabase
          .from('message_templates')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('id', template_id)
          .single();

        if (!template || template.meta_template_status !== 'approved') {
          return reply.status(400).send({ error: 'Template nao aprovado pela Meta' });
        }

        const variableKeys = resolveTemplateVariableKeys(template);
        const components = variableKeys.length > 0 && template_variables
          ? [{
              type: 'body',
              parameters: variableKeys.map((v: string) => ({
                type: 'text',
                text: template_variables[v] || '',
              })),
            }]
          : [];

        const metaResponse = await sendWhatsAppJson({
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: template.meta_template_name,
            language: { code: template.meta_template_language },
            components,
          },
        }, channel);

        const resolvedBody = resolveTemplateBody(
          normalizeEmptyTemplatePlaceholders(String(template.body || '')),
          variableKeys,
          template_variables,
        );

        const message = await persistMessage(
          {
            workspace_id: workspaceId,
            conversation_id,
            meta_message_id: metaResponse.messages?.[0]?.id || null,
            direction: 'outbound',
            type: 'template',
            content: resolvedBody,
            template_id,
            status: 'sent',
            sent_at: new Date().toISOString(),
          },
          staffPersistOpts
        );

        return reply.status(201).send(message);
      }

      if (type === 'contact') {
        if (!contact_name || !contact_phone) {
          return reply.status(400).send({ error: 'Nome e telefone do contato sao obrigatorios' });
        }

        const metaResponse = await sendWhatsAppJson({
          messaging_product: 'whatsapp',
          to,
          type: 'contacts',
          contacts: [
            {
              name: {
                formatted_name: contact_name,
                first_name: contact_name,
              },
              phones: [
                {
                  phone: contact_phone,
                  type: 'CELL',
                },
              ],
            },
          ],
        }, channel);

        const message = await persistMessage(
          {
            workspace_id: workspaceId,
            conversation_id,
            meta_message_id: metaResponse.messages?.[0]?.id || null,
            direction: 'outbound',
            type: 'contact',
            content: JSON.stringify({ name: contact_name, phone: contact_phone }),
            status: 'sent',
            sent_at: new Date().toISOString(),
          },
          staffPersistOpts
        );

        return reply.status(201).send(message);
      }

      const textBody = withSignature(content, signature);
      const allowFreeText = await lastInboundWithin24h(workspaceId, conversation_id);
      if (!allowFreeText) {
        return reply.status(400).send({
          error:
            'Fora da janela de 24h: use um template aprovado (type=template) para o destinatário receber a mensagem no WhatsApp.',
        });
      }
      const metaResponse = await sendWhatsAppJson({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: textBody, preview_url: false },
      }, channel);

      const message = await persistMessage(
        {
          workspace_id: workspaceId,
          conversation_id,
          meta_message_id: metaResponse.messages?.[0]?.id || null,
          direction: 'outbound',
          type: 'text',
          content: textBody,
          status: 'sent',
          sent_at: new Date().toISOString(),
        },
        staffPersistOpts
      );

      return reply.status(201).send(message);
    } catch (err: unknown) {
      const payload = err as { status?: number; detail?: unknown; message?: string };
      return reply.status(502).send({
        error: metaApiErrorMessage(payload.detail, payload.message || 'Falha ao enviar mensagem via WhatsApp'),
        detail: payload.detail,
      });
    }
  });

  app.post('/upload', { preHandler: [authenticate] }, async (request, reply) => {
    const uploadStarted = Date.now();
    const logStep = (step: string, extra?: Record<string, unknown>) => {
      uploadLogger.info('upload step', {
        step,
        ms: Date.now() - uploadStarted,
        ...extra,
      });
    };
    logStep('started');

    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    let parsed: ParsedMultipartUpload;
    try {
      parsed = await parseMultipartUpload(request);
      logStep('multipart_parsed', { fileName: parsed.fileName, mime: parsed.mimeType, bytes: parsed.buffer.length });
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      const message = (err as { message?: string }).message || 'Upload invalido';
      return reply.status(statusCode === 400 ? 400 : 400).send({ error: message });
    }

    const q = request.query as { conversation_id?: string };
    const conversationId = parsed.fields.conversation_id || String(q.conversation_id || '').trim();
    const requestedWorkspaceChannelId = parsed.fields.workspace_channel_id || undefined;
    const caption = parsed.fields.caption || '';
    const signature = parsed.fields.signature || '';

    if (!conversationId) return reply.status(400).send({ error: 'conversation_id obrigatorio' });

    const user = request.user as { sub: string };

    const conversation = await getConversation(conversationId, workspaceId);
    if (!conversation?.contacts?.wa_phone) return reply.status(404).send({ error: 'Conversa nao encontrada' });

    const staffPersistOpts = {
      humanHandoff: true as const,
      attendantId: user.sub,
      commercialLeadId: conversation.context_commercial_lead_id ?? null,
    };

    const to = conversation.contacts.wa_phone;
    const fileName = parsed.fileName;
    const mimeType = resolveOutboundUploadMime(parsed.mimeType, fileName);
    const buffer = parsed.buffer;
    logStep('buffer_ready', { bytes: buffer.length });
    const messageType = detectMessageType(mimeType);
    const effectiveWorkspaceChannelId = await resolveOutboundWorkspaceChannelId(
      workspaceId,
      conversation,
      requestedWorkspaceChannelId
    );
    const channel = await resolveWhatsAppConfigForConversation(workspaceId, effectiveWorkspaceChannelId);
    if (
      effectiveWorkspaceChannelId &&
      effectiveWorkspaceChannelId !== conversation.workspace_channel_id
    ) {
      await supabase
        .from('conversations')
        .update({ workspace_channel_id: effectiveWorkspaceChannelId, updated_at: new Date().toISOString() })
        .eq('workspace_id', workspaceId)
        .eq('id', conversationId);
    }
    const metaEnabled = Boolean(channel.access_token && channel.phone_number_id);

    try {
      if (metaEnabled) {
        const allowMedia = await lastInboundWithin24h(workspaceId, conversationId);
        logStep('window_24h', { allowMedia });
        if (!allowMedia) {
          return reply.status(400).send({
            error:
              'Fora da janela de 24h: documentos e mídias só podem ser enviados enquanto o cliente estiver na janela de atendimento. Use um template aprovado para retomar o contato.',
          });
        }
      }

      if (!metaEnabled) {
        const storageUrl = await uploadOutboundMessageMedia(buffer, fileName, mimeType);
        const bodyText = withSignature(caption, signature);

        const message = await persistMessage(
          {
            workspace_id: workspaceId,
            conversation_id: conversationId,
            meta_message_id: null,
            direction: 'outbound',
            type: messageType,
            content: bodyText || fileName,
            media_url: storageUrl,
            status: 'sent',
            sent_at: new Date().toISOString(),
          },
          staffPersistOpts
        );

        return reply.status(201).send(message);
      }

      const prepared = await prepareOutboundMediaForMeta(buffer, mimeType, fileName);
      logStep('media_prepared', { mime: prepared.mimeType, bytes: prepared.buffer.length });
      const [metaMedia, storageUrl] = await Promise.all([
        uploadWhatsAppMediaToMeta(prepared.buffer, prepared.fileName, prepared.mimeType, channel),
        uploadOutboundMessageMedia(buffer, fileName, mimeType),
      ]);
      logStep('meta_and_storage', { metaMediaId: metaMedia.id });

      const bodyText = withSignature(caption, signature);
      const payload =
        messageType === 'image'
          ? {
              messaging_product: 'whatsapp',
              to,
              type: 'image',
              image: { id: metaMedia.id, caption: bodyText || undefined },
            }
          : messageType === 'audio'
            ? {
                messaging_product: 'whatsapp',
                to,
                type: 'audio',
                audio: { id: metaMedia.id },
              }
            : messageType === 'video'
              ? {
                  messaging_product: 'whatsapp',
                  to,
                  type: 'video',
                  video: { id: metaMedia.id, caption: bodyText || undefined },
                }
              : {
                  messaging_product: 'whatsapp',
                  to,
                  type: 'document',
                  document: { id: metaMedia.id, filename: prepared.fileName, caption: bodyText || undefined },
                };

      const metaResponse = await sendWhatsAppJson(payload, channel);
      logStep('meta_send', { metaMessageId: metaResponse.messages?.[0]?.id || null });

      const message = await persistMessage(
        {
          workspace_id: workspaceId,
          conversation_id: conversationId,
          meta_message_id: metaResponse.messages?.[0]?.id || null,
          direction: 'outbound',
          type: messageType,
          content: bodyText || fileName,
          media_url: storageUrl,
          status: 'sent',
          sent_at: new Date().toISOString(),
        },
        staffPersistOpts
      );

      logStep('done', { messageId: message.id });
      return reply.status(201).send(message);
    } catch (err: unknown) {
      logStep('error', { message: (err as Error)?.message || String(err) });
      const payload = err as { status?: number; detail?: unknown; message?: string };
      return reply.status(502).send({
        error: metaApiErrorMessage(payload.detail, payload.message || 'Falha ao enviar midia via WhatsApp'),
        detail: payload.detail,
      });
    }
  });

  app.get('/:conversationId', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { conversationId } = request.params as { conversationId: string };
    const { page = '1', limit = '50' } = request.query as Record<string, string>;
    const offset = (Number(page) - 1) * Number(limit);

    const { data, error, count } = await supabase
      .from('messages')
      .select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .range(offset, offset + Number(limit) - 1);

    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ data: data?.reverse(), total: count, page: Number(page), limit: Number(limit) });
  });
}
