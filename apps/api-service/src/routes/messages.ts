import { randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate } from '../middleware/authenticate';
import { getWorkspaceWhatsAppChannel } from '../lib/channelResolver';
import { requireWorkspace } from '../lib/workspaceContext';
import { markConversationFirstResponseIfNeeded } from '../lib/conversationSla';

const sendMessageSchema = z.object({
  conversation_id: z.string().uuid(),
  type: z.enum(['text', 'template', 'contact']).default('text'),
  content: z.string().optional(),
  template_id: z.string().uuid().optional(),
  template_variables: z.record(z.string()).optional(),
  signature: z.string().optional(),
  contact_name: z.string().optional(),
  contact_phone: z.string().optional(),
});

const STORAGE_BUCKET = 'message-media';

type StoredConversation = {
  id: string;
  workspace_id: string;
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

async function resolveWhatsAppConfig(workspaceId: string): Promise<WhatsAppChannelConfig> {
  const channel = await getWorkspaceWhatsAppChannel(workspaceId);
  return {
    workspace_id: workspaceId,
    phone_number_id: String(channel?.external_id || channel?.credentials?.phone_number_id || '').trim() || null,
    access_token: String(channel?.credentials?.access_token || '').trim() || null,
  };
}

async function getConversation(conversationId: string, workspaceId: string): Promise<StoredConversation | null> {
  const { data } = await supabase
    .from('conversations')
    .select('id, workspace_id, contacts(wa_phone)')
    .eq('id', conversationId)
    .eq('workspace_id', workspaceId)
    .single();

  if (!data) return null;

  return {
    id: data.id,
    workspace_id: String(data.workspace_id),
    contacts: Array.isArray(data.contacts) ? data.contacts[0] : data.contacts,
  };
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

async function uploadMetaMedia(buffer: Buffer, filename: string, mimeType: string, channel: WhatsAppChannelConfig) {
  if (!channel.access_token || !channel.phone_number_id) {
    throw new Error('Meta WhatsApp nao configurado (META_ACCESS_TOKEN/META_PHONE_NUMBER_ID).');
  }
  const url = `https://graph.facebook.com/v19.0/${channel.phone_number_id}/media`;
  const blob = new Blob([buffer], { type: mimeType });
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', blob, filename);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${channel.access_token}`,
    },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw { status: response.status, detail };
  }

  return response.json() as Promise<{ id?: string }>;
}

async function ensureStorageBucket() {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((bucket) => bucket.name === STORAGE_BUCKET)) return;
  await supabase.storage.createBucket(STORAGE_BUCKET, { public: true, fileSizeLimit: 10 * 1024 * 1024 });
}

async function uploadToStorage(buffer: Buffer, fileName: string, mimeType: string) {
  await ensureStorageBucket();
  const path = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${fileName}`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, buffer, { contentType: mimeType, upsert: false });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function persistMessage(row: MessageRow) {
  const { data, error } = await supabase.from('messages').insert(row).select().single();
  if (error) throw new Error(error.message);

  await supabase
    .from('conversations')
    .update({ last_message_at: new Date().toISOString(), status: 'open', has_unread: false })
    .eq('workspace_id', row.workspace_id)
    .eq('id', row.conversation_id);

  if (row.direction === 'outbound') {
    await markConversationFirstResponseIfNeeded(row.conversation_id, new Date(row.sent_at));
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
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

export async function messageRoutes(app: FastifyInstance) {
  app.post('/send', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = sendMessageSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados invalidos', details: body.error.flatten() });

    const { conversation_id, type, content, template_id, template_variables, signature, contact_name, contact_phone } = body.data;
    const conversation = await getConversation(conversation_id, workspaceId);
    if (!conversation?.contacts?.wa_phone) return reply.status(404).send({ error: 'Conversa nao encontrada' });

    const to = conversation.contacts.wa_phone;
    const channel = await resolveWhatsAppConfig(workspaceId);
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

          const message = await persistMessage({
            workspace_id: workspaceId,
            conversation_id,
            meta_message_id: null,
            direction: 'outbound',
            type: 'template',
            content: template.body,
            template_id,
            status: 'sent',
            sent_at: new Date().toISOString(),
          });

          return reply.status(201).send(message);
        }

        if (type === 'contact') {
          if (!contact_name || !contact_phone) {
            return reply.status(400).send({ error: 'Nome e telefone do contato sao obrigatorios' });
          }

          const message = await persistMessage({
            workspace_id: workspaceId,
            conversation_id,
            meta_message_id: null,
            direction: 'outbound',
            type: 'contact',
            content: JSON.stringify({ name: contact_name, phone: contact_phone }),
            status: 'sent',
            sent_at: new Date().toISOString(),
          });

          return reply.status(201).send(message);
        }

        const textBody = withSignature(content, signature);
        const message = await persistMessage({
          workspace_id: workspaceId,
          conversation_id,
          meta_message_id: null,
          direction: 'outbound',
          type: 'text',
          content: textBody,
          status: 'sent',
          sent_at: new Date().toISOString(),
        });

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

        const components = template.variables?.length > 0 && template_variables
          ? [{
              type: 'body',
              parameters: template.variables.map((v: string) => ({
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

        const message = await persistMessage({
          workspace_id: workspaceId,
          conversation_id,
          meta_message_id: metaResponse.messages?.[0]?.id || null,
          direction: 'outbound',
          type: 'template',
          content: template.body,
          template_id,
          status: 'sent',
          sent_at: new Date().toISOString(),
        });

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

        const message = await persistMessage({
          workspace_id: workspaceId,
          conversation_id,
          meta_message_id: metaResponse.messages?.[0]?.id || null,
          direction: 'outbound',
          type: 'contact',
          content: JSON.stringify({ name: contact_name, phone: contact_phone }),
          status: 'sent',
          sent_at: new Date().toISOString(),
        });

        return reply.status(201).send(message);
      }

      const textBody = withSignature(content, signature);
      const metaResponse = await sendWhatsAppJson({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: textBody, preview_url: false },
      }, channel);

      const message = await persistMessage({
        workspace_id: workspaceId,
        conversation_id,
        meta_message_id: metaResponse.messages?.[0]?.id || null,
        direction: 'outbound',
        type: 'text',
        content: textBody,
        status: 'sent',
        sent_at: new Date().toISOString(),
      });

      return reply.status(201).send(message);
    } catch (err: unknown) {
      const payload = err as { status?: number; detail?: unknown; message?: string };
      return reply.status(502).send({
        error: payload.message || 'Falha ao enviar mensagem via WhatsApp',
        detail: payload.detail,
      });
    }
  });

  app.post('/upload', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: 'Arquivo obrigatorio' });

    const fields = file.fields as Record<string, { value?: string }>;
    const conversationId = fields.conversation_id?.value;
    const caption = fields.caption?.value || '';
    const signature = fields.signature?.value || '';

    if (!conversationId) return reply.status(400).send({ error: 'conversation_id obrigatorio' });

    const conversation = await getConversation(conversationId, workspaceId);
    if (!conversation?.contacts?.wa_phone) return reply.status(404).send({ error: 'Conversa nao encontrada' });

    const to = conversation.contacts.wa_phone;
    const mimeType = file.mimetype || 'application/octet-stream';
    const fileName = file.filename || 'arquivo';
    const buffer = await file.toBuffer();
    const messageType = detectMessageType(mimeType);
    const channel = await resolveWhatsAppConfig(workspaceId);
    const metaEnabled = Boolean(channel.access_token && channel.phone_number_id);

    try {
      if (!metaEnabled) {
        const storageUrl = await uploadToStorage(buffer, fileName, mimeType);
        const bodyText = withSignature(caption, signature);

        const message = await persistMessage({
          workspace_id: workspaceId,
          conversation_id: conversationId,
          meta_message_id: null,
          direction: 'outbound',
          type: messageType,
          content: bodyText || fileName,
          media_url: storageUrl,
          status: 'sent',
          sent_at: new Date().toISOString(),
        });

        return reply.status(201).send(message);
      }

      const [storageUrl, metaMedia] = await Promise.all([
        uploadToStorage(buffer, fileName, mimeType),
        uploadMetaMedia(buffer, fileName, mimeType, channel),
      ]);

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
            : {
                messaging_product: 'whatsapp',
                to,
                type: 'document',
                document: { id: metaMedia.id, filename: fileName, caption: bodyText || undefined },
              };

      const metaResponse = await sendWhatsAppJson(payload, channel);

      const message = await persistMessage({
        workspace_id: workspaceId,
        conversation_id: conversationId,
        meta_message_id: metaResponse.messages?.[0]?.id || null,
        direction: 'outbound',
        type: messageType,
        content: bodyText || fileName,
        media_url: storageUrl,
        status: 'sent',
        sent_at: new Date().toISOString(),
      });

      return reply.status(201).send(message);
    } catch (err: unknown) {
      const payload = err as { status?: number; detail?: unknown; message?: string };
      return reply.status(502).send({
        error: payload.message || 'Falha ao enviar midia via WhatsApp',
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
