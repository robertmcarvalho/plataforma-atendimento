import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PubSub } from '@google-cloud/pubsub';
import { supabase } from '../lib/supabase';
import { authenticate, requireRole } from '../middleware/authenticate';
import { requireWorkspace } from '../lib/workspaceContext';

const pubsub = new PubSub({ projectId: process.env.GOOGLE_CLOUD_PROJECT_ID });

const dispatchConfigSchema = z.object({
  batch_size: z.number().int().min(1).max(50).default(10),
  pause_between_messages_ms: z.number().int().min(1000).default(1500),
  pause_between_batches_ms: z.number().int().min(30000).default(60000),
  max_per_hour: z.number().int().min(10).max(500).default(200),
  jitter_ms: z.number().int().min(0).max(2000).default(500),
  retry_on_failure: z.boolean().default(true),
  max_retries: z.number().int().min(0).max(5).default(3),
  retry_backoff_ms: z.number().int().min(5000).default(30000),
});

const campaignSchema = z.object({
  name: z.string().min(2),
  type: z.enum(['manual', 'scheduled', 'automated']).default('manual'),
  template_id: z.string().uuid(),
  audience_type: z.enum(['drivers', 'leaders', 'pharmacies', 'custom']),
  audience_filters: z.record(z.unknown()).default({}),
  scheduled_at: z.string().datetime().optional(),
  dispatch_config: dispatchConfigSchema.default({}),
});

const campaignUpdateSchema = campaignSchema.partial().extend({
  name: z.string().min(2).optional(),
});

export async function campaignRoutes(app: FastifyInstance) {
  // GET /api/campaigns
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { status } = request.query as { status?: string };
    let query = supabase
      .from('campaigns')
      .select('*, template:message_templates(id, name, category), created_by_user:users!created_by(id, name)')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  // GET /api/campaigns/:id — com destinatários
  app.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('campaigns')
      .select(`*, template:message_templates(id, name, category, body, variables),
        campaign_recipients(id, wa_phone, status, sent_at, delivered_at, read_at, error_message)`)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();
    if (error) return reply.status(404).send({ error: 'Campanha não encontrada' });
    return reply.send(data);
  });

  // POST /api/campaigns — criar campanha
  app.post('/', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = campaignSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });
    const user = request.user as { sub: string };

    if (body.data.type === 'scheduled' && !body.data.scheduled_at) {
      return reply.status(400).send({ error: 'Campanha agendada exige scheduled_at' });
    }

    // Valida que template está aprovado
    const { data: template } = await supabase
      .from('message_templates').select('meta_template_status').eq('workspace_id', workspaceId).eq('id', body.data.template_id).single();
    if (!template || template.meta_template_status !== 'approved') {
      return reply.status(400).send({ error: 'Apenas templates aprovados pela Meta podem ser usados em campanhas' });
    }

    const { data, error } = await supabase
      .from('campaigns')
      .insert({
        workspace_id: workspaceId,
        ...body.data,
        created_by: user.sub,
        status: body.data.type === 'scheduled' ? 'scheduled' : 'draft',
      })
      .select().single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send(data);
  });

  // POST /api/campaigns/:id/preview — pré-visualizar destinatários
  // PUT /api/campaigns/:id â€” editar campanha (apenas draft/scheduled)
  app.put('/:id', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = campaignUpdateSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados invÃ¡lidos', details: body.error.flatten() });

    const { data: current, error: fetchErr } = await supabase
      .from('campaigns')
      .select('id, status')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();
    if (fetchErr || !current) return reply.status(404).send({ error: 'Campanha nÃ£o encontrada' });
    if (!['draft', 'scheduled'].includes(current.status)) {
      return reply.status(400).send({ error: 'Campanha nÃ£o pode ser editada neste estado' });
    }

    if (body.data.type === 'scheduled' && !body.data.scheduled_at) {
      return reply.status(400).send({ error: 'Campanha agendada exige scheduled_at' });
    }

    if (body.data.template_id) {
      const { data: template } = await supabase
        .from('message_templates').select('meta_template_status').eq('workspace_id', workspaceId).eq('id', body.data.template_id).single();
      if (!template || template.meta_template_status !== 'approved') {
        return reply.status(400).send({ error: 'Apenas templates aprovados pela Meta podem ser usados em campanhas' });
      }
    }

    const nextStatus = body.data.type === 'scheduled'
      ? 'scheduled'
      : current.status === 'scheduled'
        ? 'draft'
        : current.status;

    const { data, error } = await supabase
      .from('campaigns')
      .update({ ...body.data, status: nextStatus, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();

    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  app.post('/:id/preview', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('audience_type, audience_filters, dispatch_config')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();
    if (!campaign) return reply.status(404).send({ error: 'Campanha não encontrada' });

    const recipients = await resolveAudience(workspaceId, campaign.audience_type, campaign.audience_filters as Record<string, unknown>);

    // Estima tempo de conclusão
    const config = {
      batch_size: 10,
      pause_between_messages_ms: 1500,
      pause_between_batches_ms: 60000,
      ...(campaign.dispatch_config || {}),
    } as { batch_size: number; pause_between_messages_ms: number; pause_between_batches_ms: number };
    const batches = Math.ceil(recipients.length / config.batch_size);
    const estimatedMs = batches * config.pause_between_batches_ms + recipients.length * config.pause_between_messages_ms;
    const estimatedMinutes = Math.round(estimatedMs / 60000);

    return reply.send({ total: recipients.length, estimated_minutes: estimatedMinutes, sample: recipients.slice(0, 5) });
  });

  // POST /api/campaigns/:id/dispatch — disparar agora
  app.post('/:id/dispatch', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data: campaign } = await supabase.from('campaigns').select('*').eq('workspace_id', workspaceId).eq('id', id).single();
    if (!campaign || !['draft', 'scheduled'].includes(campaign.status)) {
      return reply.status(400).send({ error: 'Campanha não pode ser disparada neste estado' });
    }

    // Resolve audiência e insere destinatários
    const recipients = await resolveAudience(workspaceId, campaign.audience_type, campaign.audience_filters as Record<string, unknown>);
    if (recipients.length === 0) return reply.status(400).send({ error: 'Nenhum destinatário encontrado com os filtros aplicados' });

    const recipientRows = recipients.map((r: { wa_phone: string; variables?: Record<string, string> }) => ({
      workspace_id: workspaceId,
      campaign_id: id,
      wa_phone: r.wa_phone,
      variables: r.variables || {},
      status: 'pending',
    }));

    await supabase.from('campaign_recipients').insert(recipientRows);
    await supabase.from('campaigns').update({
      status: 'running',
      total_recipients: recipients.length,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('workspace_id', workspaceId).eq('id', id);

    const data = Buffer.from(JSON.stringify({ campaign_id: id, workspace_id: workspaceId }));
    await pubsub.topic(process.env.PUBSUB_TOPIC_CAMPAIGN!).publishMessage({ data });

    return reply.send({ message: 'Campanha iniciada', campaign_id: id, total_recipients: recipients.length });
  });

  // PATCH /api/campaigns/:id/pause — pausar
  app.patch('/:id/pause', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('campaigns').update({ status: 'paused', updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId).eq('id', id).eq('status', 'running').select().single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  // PATCH /api/campaigns/:id/resume — retomar
  app.patch('/:id/resume', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('campaigns').update({ status: 'running', updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId).eq('id', id).eq('status', 'paused').select().single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });
}

// Resolve a audiência da campanha com base nos filtros
async function resolveAudience(workspaceId: string, audienceType: string, filters: Record<string, unknown>) {
  if (audienceType === 'drivers') {
    let query = supabase
      .from('drivers')
      .select('id, name, phone, primary_pharmacy_id')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active');
    if (filters.pharmacy_id) query = query.eq('primary_pharmacy_id', filters.pharmacy_id as string);
    if (filters.doc_status) query = query.eq('doc_status', filters.doc_status as string);
    const { data } = await query;
    return (data || []).map((d: { phone: string; name: string }) => ({ wa_phone: d.phone, variables: { nome: d.name } }));
  }
  if (audienceType === 'leaders') {
    const { data } = await supabase.from('leaders').select('id, name, phone').eq('workspace_id', workspaceId).eq('status', 'active');
    return (data || []).map((l: { phone: string; name: string }) => ({ wa_phone: l.phone, variables: { nome: l.name } }));
  }
  if (audienceType === 'pharmacies') {
    const { data } = await supabase
      .from('pharmacies')
      .select('id, trade_name, phone')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .not('phone', 'is', null);
    return (data || []).map((p: { phone: string; trade_name: string }) => ({ wa_phone: p.phone, variables: { nome: p.trade_name } }));
  }
  if (audienceType === 'custom') {
    const phones = Array.isArray(filters.phones) ? filters.phones : [];
    const normalized = phones
      .filter((p): p is string => typeof p === 'string')
      .map((p) => p.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    return normalized
      .filter((p) => {
        if (seen.has(p)) return false;
        seen.add(p);
        return true;
      })
      .map((p) => ({ wa_phone: p, variables: {} }));
  }
  return [];
}
