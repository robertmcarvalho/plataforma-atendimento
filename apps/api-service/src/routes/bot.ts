import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate, requireRole } from '../middleware/authenticate';
import { requireWorkspace } from '../lib/workspaceContext';

const profileSchema = z.enum(['driver', 'pharmacy', 'leader', 'unknown']).nullable().optional();
// "Intencao" agora e livre (ex: nome do setor). Mantemos compatibilidade com valores legados.
const intentSchema = z.string().trim().min(1).nullable().optional();

const routingRuleSchema = z.object({
  name: z.string().min(2),
  priority: z.number().int().default(0),
  profile_type: profileSchema,
  // Novo: intent por Setor (FK em conversations.intent_sector_id). Mantemos `intent` (texto) como legado.
  intent_sector_id: z.string().uuid().nullable().optional(),
  intent: intentSchema,
  // Novo: keywords para casar com texto inbound.
  keywords_any: z.array(z.string()).default([]),
  keywords_all: z.array(z.string()).default([]),
  requires_context_pharmacy: z.boolean().default(false),
  route_to: z.enum(['sector', 'pharmacy_attendant', 'attendant']).default('sector'),
  target_name: z.string().optional().nullable(),
  target_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().default(true),
});

const flowSchema = z.object({
  name: z.string().min(2),
  trigger_keywords: z.array(z.string()).default([]),
  message: z.string().min(1),
  is_active: z.boolean().default(true),
});

function serializeRule(rule: z.infer<typeof routingRuleSchema>) {
  return {
    name: rule.name,
    priority: rule.priority,
    conditions: {
      profile_type: rule.profile_type || null,
      intent_sector_id: rule.intent_sector_id || null,
      intent: rule.intent || null,
      keywords_any: (rule.keywords_any || [])
        .map((x) => String(x || '').trim())
        .filter(Boolean),
      keywords_all: (rule.keywords_all || [])
        .map((x) => String(x || '').trim())
        .filter(Boolean),
      requires_context_pharmacy: rule.requires_context_pharmacy,
    },
    action: {
      route_to: rule.route_to,
      target_name: rule.target_name || null,
      target_id: rule.target_id || null,
    },
    is_active: rule.is_active,
  };
}

function deserializeRule(record: {
  id: string;
  name: string;
  priority: number;
  is_active: boolean;
  created_at: string;
  conditions: Record<string, unknown> | null;
  action: Record<string, unknown> | null;
}) {
  const kwAny = record.conditions?.keywords_any;
  const kwAll = record.conditions?.keywords_all;
  return {
    id: record.id,
    name: record.name,
    priority: record.priority,
    is_active: record.is_active,
    created_at: record.created_at,
    profile_type: (record.conditions?.profile_type as string | null) || null,
    intent: (record.conditions?.intent as string | null) || null,
    intent_sector_id: (record.conditions?.intent_sector_id as string | null) || null,
    keywords_any: Array.isArray(kwAny) ? (kwAny as unknown[]).map(String).filter(Boolean) : [],
    keywords_all: Array.isArray(kwAll) ? (kwAll as unknown[]).map(String).filter(Boolean) : [],
    requires_context_pharmacy: Boolean(record.conditions?.requires_context_pharmacy),
    route_to: (record.action?.route_to as string | null) || 'sector',
    target_name: (record.action?.target_name as string | null) || null,
    target_id: (record.action?.target_id as string | null) || null,
  };
}

function serializeFlow(flow: z.infer<typeof flowSchema>) {
  return {
    name: flow.name,
    trigger_keywords: flow.trigger_keywords,
    steps: [{ type: 'message', content: flow.message }],
    is_active: flow.is_active,
  };
}

function deserializeFlow(record: {
  id: string;
  name: string;
  trigger_keywords: string[] | null;
  steps: Array<{ type?: string; content?: string; message?: string }> | null;
  is_active: boolean;
  created_at: string;
}) {
  const firstStep = Array.isArray(record.steps) ? record.steps[0] : null;
  return {
    id: record.id,
    name: record.name,
    trigger_keywords: record.trigger_keywords || [],
    message: firstStep?.content || firstStep?.message || '',
    is_active: record.is_active,
    created_at: record.created_at,
  };
}

export async function botRoutes(app: FastifyInstance) {
  // GET /api/bot/drivers/:id/pharmacies — farmácias vinculadas ao entregador (N:N)
  app.get('/drivers/:id/pharmacies', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };

    const { data, error } = await supabase
      .from('driver_pharmacy_links')
      .select('is_primary, is_active, pharmacies(id, trade_name, city, state)')
      .eq('workspace_id', workspaceId)
      .eq('driver_id', id)
      .eq('is_active', true)
      .order('is_primary', { ascending: false });

    if (error) return reply.status(500).send({ error: error.message });

    const items = (data || [])
      .map((r: any) => ({
        is_primary: Boolean(r.is_primary),
        pharmacy: Array.isArray(r.pharmacies) ? r.pharmacies[0] : r.pharmacies,
      }))
      .filter((x) => x.pharmacy?.id);

    return reply.send(items);
  });

  // GET /api/bot/conversations/:id/pharmacy-options — payload para triagem (sem webhook)
  app.get('/conversations/:id/pharmacy-options', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };

    const { data: conv, error: convError } = await supabase
      .from('conversations')
      .select('id, contact_id, contacts(id, profile_type, driver_id)')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();

    if (convError || !conv) return reply.status(404).send({ error: 'Conversa não encontrada' });

    const contacts = Array.isArray((conv as any).contacts) ? (conv as any).contacts[0] : (conv as any).contacts;
    const driverId = contacts?.driver_id as string | null;
    const profile = contacts?.profile_type as string | null;

    if (profile !== 'driver' || !driverId) return reply.send({ required: false, options: [] });

    const { data, error } = await supabase
      .from('driver_pharmacy_links')
      .select('is_primary, is_active, pharmacies(id, trade_name, city, state)')
      .eq('workspace_id', workspaceId)
      .eq('driver_id', driverId)
      .eq('is_active', true)
      .order('is_primary', { ascending: false });

    if (error) return reply.status(500).send({ error: error.message });

    const options = (data || [])
      .map((r: any) => (Array.isArray(r.pharmacies) ? r.pharmacies[0] : r.pharmacies))
      .filter((p: any) => p?.id)
      .slice(0, 10);

    const required = options.length > 1;
    const message = required
      ? `Você atua em mais de uma farmácia. Por favor, responda com o número:\n${options
          .map((p: any, i: number) => `${i + 1}) ${p.trade_name}`)
          .join('\n')}`
      : null;

    return reply.send({ required, driver_id: driverId, options, message });
  });

  app.get('/routing-rules', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { data, error } = await supabase.from('routing_rules').select('*').eq('workspace_id', workspaceId).order('priority', { ascending: false });
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send((data || []).map((item) => deserializeRule(item as never)));
  });

  app.post('/routing-rules', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    if (!legacyAutomationWritesEnabled()) {
      return reply.status(410).send({
        error: 'Criação de routing_rules legado congelada. Use workspace_channels.config como fonte operacional oficial.',
        code: 'AUTOMATION_CONFLICT',
      });
    }
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = routingRuleSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados invalidos', details: body.error.flatten() });
    const { data, error } = await supabase.from('routing_rules').insert({ workspace_id: workspaceId, ...serializeRule(body.data) }).select().single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send(deserializeRule(data as never));
  });

  app.put('/routing-rules/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = routingRuleSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados invalidos', details: body.error.flatten() });
    const { data, error } = await supabase.from('routing_rules').update(serializeRule(body.data)).eq('workspace_id', workspaceId).eq('id', id).select().single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(deserializeRule(data as never));
  });

  app.patch('/routing-rules/:id/toggle', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const current = await supabase.from('routing_rules').select('is_active').eq('workspace_id', workspaceId).eq('id', id).single();
    if (current.error || !current.data) return reply.status(404).send({ error: 'Regra nao encontrada' });
    const { data, error } = await supabase
      .from('routing_rules')
      .update({ is_active: !current.data.is_active })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(deserializeRule(data as never));
  });

  app.delete('/routing-rules/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { error } = await supabase.from('routing_rules').delete().eq('workspace_id', workspaceId).eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ ok: true });
  });

  app.get('/flows', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { data, error } = await supabase.from('bot_flows').select('*').eq('workspace_id', workspaceId).order('name');
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send((data || []).map((item) => deserializeFlow(item as never)));
  });

  app.post('/flows', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    if (!legacyAutomationWritesEnabled()) {
      return reply.status(410).send({
        error: 'Criação de bot_flows legado congelada. Use workspace_channels.config como fonte operacional oficial.',
        code: 'AUTOMATION_CONFLICT',
      });
    }
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = flowSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados invalidos', details: body.error.flatten() });
    const { data, error } = await supabase.from('bot_flows').insert({ workspace_id: workspaceId, ...serializeFlow(body.data) }).select().single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send(deserializeFlow(data as never));
  });

  app.put('/flows/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = flowSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados invalidos', details: body.error.flatten() });
    const { data, error } = await supabase.from('bot_flows').update(serializeFlow(body.data)).eq('workspace_id', workspaceId).eq('id', id).select().single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(deserializeFlow(data as never));
  });

  app.patch('/flows/:id/toggle', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const current = await supabase.from('bot_flows').select('is_active').eq('workspace_id', workspaceId).eq('id', id).single();
    if (current.error || !current.data) return reply.status(404).send({ error: 'Fluxo nao encontrado' });
    const { data, error } = await supabase
      .from('bot_flows')
      .update({ is_active: !current.data.is_active })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(deserializeFlow(data as never));
  });

  app.delete('/flows/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { error } = await supabase.from('bot_flows').delete().eq('workspace_id', workspaceId).eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ ok: true });
  });
}

function legacyAutomationWritesEnabled() {
  return process.env.ALLOW_LEGACY_AUTOMATION_WRITES === 'true';
}
