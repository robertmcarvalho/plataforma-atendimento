import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate } from '../middleware/authenticate';
import { requireContactsManage } from '../lib/permissions';
import { requireWorkspace } from '../lib/workspaceContext';
import { runSignatureSyncForWorkspace } from '../lib/signatureStatusSync';

const profileSchema = z.enum(['driver', 'pharmacy', 'leader', 'partner', 'unknown']);

const contactSchema = z.object({
  wa_phone: z.string().min(8),
  display_name: z.string().optional().nullable(),
  profile_type: profileSchema.default('unknown'),
  driver_id: z.string().uuid().optional().nullable(),
  pharmacy_id: z.string().uuid().optional().nullable(),
  leader_id: z.string().uuid().optional().nullable(),
  is_blocked: z.boolean().default(false),
});

function normalizePayload(input: z.infer<typeof contactSchema>) {
  const profileType =
    input.profile_type !== 'unknown'
      ? input.profile_type
      : input.driver_id
        ? 'driver'
        : input.pharmacy_id
          ? 'pharmacy'
          : input.leader_id
            ? 'leader'
            : 'unknown';

  return {
    wa_phone: input.wa_phone,
    display_name: input.display_name || null,
    profile_type: profileType,
    driver_id: profileType === 'driver' ? input.driver_id || null : null,
    pharmacy_id: profileType === 'pharmacy' ? input.pharmacy_id || null : null,
    leader_id: profileType === 'leader' ? input.leader_id || null : null,
    is_blocked: input.is_blocked,
  };
}

export async function contactRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { search, profile_type, blocked } = request.query as Record<string, string>;

    let query = supabase
      .from('contacts')
      .select(`
        *,
        driver:drivers(id, name, phone),
        pharmacy:pharmacies(id, trade_name, phone),
        leader:leaders(id, name, phone)
      `)
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false });

    if (profile_type) query = query.eq('profile_type', profile_type);
    if (blocked === 'true') query = query.eq('is_blocked', true);
    if (blocked === 'false') query = query.eq('is_blocked', false);
    if (search) query = query.or(`display_name.ilike.%${search}%,wa_phone.ilike.%${search}%`);

    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  // GET /api/contacts/:id/conversations — conversas anteriores do contato
  app.get('/:id/conversations', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { exclude, limit = '5' } = request.query as { exclude?: string; limit?: string };

    let query = supabase
      .from('conversations')
      .select(
        'id, status, priority, opened_at, last_message_at, resolved_at, close_reason, summary, ai_sentiment_last, ai_urgency_score, ai_topic_id, ai_topic_set_at, ai_nps_predicted, ai_nps_set_at'
      )
      .eq('workspace_id', workspaceId)
      .eq('contact_id', id)
      .in('status', ['resolved', 'closed'])
      .order('opened_at', { ascending: false })
      .limit(Math.max(1, Math.min(50, Number(limit) || 5)));

    if (exclude) query = query.neq('id', exclude);

    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data || []);
  });

  app.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('contacts')
      .select(`
        *,
        driver:drivers(id, name, phone, city, status),
        pharmacy:pharmacies(id, trade_name, phone, city, state, status),
        leader:leaders(id, name, phone, city, status)
      `)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();

    if (error) return reply.status(404).send({ error: 'Contato nao encontrado' });
    return reply.send(data);
  });

  app.post('/', { preHandler: [authenticate, requireContactsManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = contactSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados invalidos', details: body.error.flatten() });

    const payload = normalizePayload(body.data);
    const { data, error } = await supabase.from('contacts').insert({ workspace_id: workspaceId, ...payload }).select().single();
    if (error) {
      if ((error.message || '').toLowerCase().includes('unique') || error.code === '23505') {
        const { data: existing } = await supabase
          .from('contacts')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('wa_phone', payload.wa_phone)
          .maybeSingle();
        return reply.status(409).send({
          error: 'Ja existe um contato com este telefone',
          code: 'DUPLICATE_WA_PHONE',
          existing_contact_id: existing?.id ?? null,
        });
      }
      return reply.status(500).send({ error: error.message });
    }
    return reply.status(201).send(data);
  });

  app.put('/:id', { preHandler: [authenticate, requireContactsManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = contactSchema.partial().safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados invalidos', details: body.error.flatten() });

    const current = await supabase.from('contacts').select('*').eq('workspace_id', workspaceId).eq('id', id).single();
    if (current.error || !current.data) return reply.status(404).send({ error: 'Contato nao encontrado' });

    const payload = normalizePayload({
      wa_phone: body.data.wa_phone ?? current.data.wa_phone,
      display_name: body.data.display_name ?? current.data.display_name,
      profile_type: body.data.profile_type ?? current.data.profile_type,
      driver_id: body.data.driver_id ?? current.data.driver_id,
      pharmacy_id: body.data.pharmacy_id ?? current.data.pharmacy_id,
      leader_id: body.data.leader_id ?? current.data.leader_id,
      is_blocked: body.data.is_blocked ?? current.data.is_blocked,
    });

    const { data, error } = await supabase
      .from('contacts')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();

    if (error) return reply.status(500).send({ error: error.message });

    const prevDriverId = current.data.driver_id ? String(current.data.driver_id) : '';
    const nextDriverId = payload.driver_id ? String(payload.driver_id) : '';
    if (nextDriverId && nextDriverId !== prevDriverId) {
      void runSignatureSyncForWorkspace(supabase, workspaceId).catch(() => undefined);
    }

    return reply.send(data);
  });

  app.patch('/:id/block', { preHandler: [authenticate, requireContactsManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { blocked } = (request.body || {}) as { blocked?: boolean };

    const { data, error } = await supabase
      .from('contacts')
      .update({ is_blocked: blocked !== false, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();

    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });
}
