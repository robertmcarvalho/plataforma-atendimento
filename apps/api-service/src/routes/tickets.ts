import { randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate } from '../middleware/authenticate';
import { sectorIdsFromJwt } from '../lib/jwtSectorIds';
import { requireWorkspace } from '../lib/workspaceContext';

const openFromMessageSchema = z.object({
  conversation_id: z.string().uuid(),
  message_id: z.string().uuid().optional(),
});

const updateTicketSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'overdue']).optional(),
  assignee_user_id: z.string().uuid().nullable().optional(),
  priority: z.enum(['high', 'medium', 'normal', 'bot']).optional(),
});

type Classification = {
  type: 'payment' | 'contestation' | 'app' | 'question' | 'advance';
  priority: 'high' | 'medium' | 'normal' | 'bot';
  sla_minutes: 120 | 240 | 480 | 1440;
};

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function classifyMessage(text: string): Classification {
  const normalized = normalizeText(text);
  const hasAny = (terms: string[]) => terms.some((term) => normalized.includes(term));

  if (hasAny(['pagamento', 'pix', 'nao caiu', 'cade meu dinheiro'])) {
    return { type: 'payment', priority: 'high', sla_minutes: 120 };
  }
  if (hasAny(['desconto errado', 'contestar', 'nao faltei', 'injusto'])) {
    return { type: 'contestation', priority: 'medium', sla_minutes: 240 };
  }
  if (hasAny(['app travou', 'bug', 'nao abre', 'erro'])) {
    return { type: 'app', priority: 'normal', sla_minutes: 480 };
  }
  if (hasAny(['quanto vou receber', 'meu extrato', 'quando paga'])) {
    return { type: 'question', priority: 'bot', sla_minutes: 1440 };
  }
  return { type: 'advance', priority: 'normal', sla_minutes: 480 };
}

function buildTicketCode(): string {
  const seed = Date.now().toString(36).toUpperCase();
  const suffix = randomUUID().slice(0, 6).toUpperCase();
  return `TKT-${seed}-${suffix}`;
}

async function buildContextSnapshot(workspaceId: string, conversationId: string, classification: Classification, messageText: string) {
  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, contact_id, context_driver_id, context_leader_id, context_pharmacy_id, sector_id')
    .eq('workspace_id', workspaceId)
    .eq('id', conversationId)
    .maybeSingle();

  return {
    captured_at: new Date().toISOString(),
    conversation: conversation || null,
    message_excerpt: messageText.slice(0, 280),
    financial_snapshot: {
      source: 'placeholder-v1',
      note: 'Snapshot financeiro completo sera ligado ao modulo financeiro na proxima iteracao.',
    },
    classification,
  };
}

export async function ticketRoutes(app: FastifyInstance) {
  app.post('/open-from-message', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = openFromMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados invalidos', details: parsed.error.flatten() });
    }

    const { conversation_id, message_id } = parsed.data;
    let messageQuery = supabase
      .from('messages')
      .select('id, content')
      .eq('workspace_id', workspaceId)
      .eq('conversation_id', conversation_id)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(1);

    if (message_id) messageQuery = messageQuery.eq('id', message_id);
    const { data: message, error: msgErr } = await messageQuery.maybeSingle();
    if (msgErr) return reply.status(500).send({ error: msgErr.message });
    if (!message) return reply.status(404).send({ error: 'Mensagem de origem nao encontrada' });

    const content = String(message.content || '');
    const classification = classifyMessage(content);
    const dueAt = new Date(Date.now() + classification.sla_minutes * 60 * 1000).toISOString();
    const contextSnap = await buildContextSnapshot(workspaceId, conversation_id, classification, content);

    const { data: convCtx } = await supabase
      .from('conversations')
      .select('context_driver_id, context_leader_id, context_pharmacy_id')
      .eq('workspace_id', workspaceId)
      .eq('id', conversation_id)
      .maybeSingle();

    const insertPayload = {
      ticket_code: buildTicketCode(),
      workspace_id: workspaceId,
      conversation_id,
      persona: convCtx?.context_driver_id ? 'driver' : convCtx?.context_leader_id ? 'leader' : 'pharmacy',
      type: classification.type,
      priority: classification.priority,
      sla_minutes: classification.sla_minutes,
      channel_origin: 'whatsapp',
      driver_id: convCtx?.context_driver_id || null,
      leader_id: convCtx?.context_leader_id || null,
      pharmacy_id: convCtx?.context_pharmacy_id || null,
      due_at: dueAt,
      context_snap: contextSnap,
      classifier_version: 'v1-keyword',
    };

    const { data: ticket, error } = await supabase.from('tickets').insert(insertPayload).select('*').single();
    if (error) return reply.status(500).send({ error: error.message });

    await supabase.from('ticket_events').insert({
      workspace_id: workspaceId,
      ticket_id: ticket.id,
      event_type: 'ticket_opened',
      payload: {
        message_id: message.id,
        classification,
      },
      created_by: (request.user as { sub?: string }).sub || null,
    });

    return reply.status(201).send(ticket);
  });

  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { role?: string; sector_id?: string | null; sector_ids?: string[] };
    let sectorConvIds: string[] | null = null;
    const MAX_CONV_IN = 500;
    if (user.role === 'supervisor') {
      const sids = sectorIdsFromJwt(user);
      if (sids.length) {
        const { data: convRows, error: convScopeErr } = await supabase
          .from('conversations')
          .select('id')
          .eq('workspace_id', workspaceId)
          .in('sector_id', sids)
          .limit(2500);
        if (convScopeErr) return reply.status(500).send({ error: convScopeErr.message });
        sectorConvIds = (convRows || []).map((c: { id: string }) => c.id).filter(Boolean).slice(0, MAX_CONV_IN);
        if (!sectorConvIds.length) return reply.send([]);
      }
    }

    const {
      status,
      priority,
      persona,
      assignee_user_id,
      conversation_id,
      driver_id,
      leader_id,
      pharmacy_id,
      contact_id,
      exclude_ticket_id,
      limit = '50',
    } = request.query as Record<string, string>;
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);

    if (conversation_id && sectorConvIds && !sectorConvIds.includes(conversation_id)) {
      return reply.send([]);
    }

    let query = supabase.from('tickets').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(safeLimit);
    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);
    if (persona) query = query.eq('persona', persona);
    if (assignee_user_id) query = query.eq('assignee_user_id', assignee_user_id);
    if (conversation_id) query = query.eq('conversation_id', conversation_id);
    if (driver_id) query = query.eq('driver_id', driver_id);
    if (leader_id) query = query.eq('leader_id', leader_id);
    if (pharmacy_id) query = query.eq('pharmacy_id', pharmacy_id);
    if (exclude_ticket_id) query = query.neq('id', exclude_ticket_id);

    if (contact_id) {
      const { data: convs, error: convErr } = await supabase.from('conversations').select('id').eq('workspace_id', workspaceId).eq('contact_id', contact_id);
      if (convErr) return reply.status(500).send({ error: convErr.message });
      let ids = (convs || []).map((c: { id: string }) => c.id);
      if (sectorConvIds) {
        const sidSet = new Set(sectorConvIds);
        ids = ids.filter((id: string) => sidSet.has(id));
      }
      if (ids.length === 0) return reply.send([]);
      query = query.in('conversation_id', ids);
    } else if (sectorConvIds && !conversation_id) {
      query = query.in('conversation_id', sectorConvIds);
    }

    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data || []);
  });

  app.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase.from('tickets').select('*').eq('workspace_id', workspaceId).eq('id', id).maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Ticket nao encontrado' });
    return reply.send(data);
  });

  app.patch('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const parsed = updateTicketSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados invalidos', details: parsed.error.flatten() });
    }

    const updates: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };
    if (parsed.data.status === 'in_progress') updates.started_at = new Date().toISOString();
    if (parsed.data.status === 'resolved') updates.resolved_at = new Date().toISOString();

    const { data, error } = await supabase.from('tickets').update(updates).eq('workspace_id', workspaceId).eq('id', id).select('*').single();
    if (error) return reply.status(500).send({ error: error.message });

    await supabase.from('ticket_events').insert({
      workspace_id: workspaceId,
      ticket_id: id,
      event_type: 'ticket_updated',
      payload: parsed.data,
      created_by: (request.user as { sub?: string }).sub || null,
    });

    return reply.send(data);
  });

  app.get('/:id/timeline', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('ticket_events')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('ticket_id', id)
      .order('created_at', { ascending: true });
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data || []);
  });
}
