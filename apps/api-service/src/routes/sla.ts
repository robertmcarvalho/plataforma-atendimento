import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate, requireRole } from '../middleware/authenticate';
import { requireWorkspace } from '../lib/workspaceContext';
import { sectorIdsFromJwt } from '../lib/jwtSectorIds';
import { isInAppEnabled } from '../lib/notificationPreferences';

const slaPolicySchema = z.object({
  name: z.string().min(2),
  sector_id: z.string().uuid().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  profile_type: z.enum(['driver', 'pharmacy', 'leader']).optional(),
  first_response_minutes: z.number().int().min(1).default(30),
  treatment_minutes: z.number().int().min(1).default(120),
  resolution_minutes: z.number().int().min(1).default(480),
  use_business_hours: z.boolean().default(true),
});

export async function slaRoutes(app: FastifyInstance) {
  // GET /api/sla/policies
  app.get('/policies', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { data, error } = await supabase
      .from('sla_policies')
      .select('*, sectors(id, name)')
      .eq('workspace_id', workspaceId)
      .order('name');
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  // POST /api/sla/policies
  app.post('/policies', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = slaPolicySchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });
    const { data, error } = await supabase.from('sla_policies').insert({ ...body.data, workspace_id: workspaceId }).select().single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send(data);
  });

  // PUT /api/sla/policies/:id
  app.put('/policies/:id', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = slaPolicySchema.partial().safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });
    const { data, error } = await supabase
      .from('sla_policies')
      .update(body.data)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  // DELETE /api/sla/policies/:id
  app.delete('/policies/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { error } = await supabase.from('sla_policies').delete().eq('workspace_id', workspaceId).eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(204).send();
  });

  // GET /api/sla/events — alertas de SLA
  app.get('/events', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    const sub = (request.user as { sub: string }).sub;
    const { data: prefRow } = await supabase.from('users').select('notification_preferences').eq('id', sub).maybeSingle();
    if (!isInAppEnabled(prefRow?.notification_preferences as Record<string, unknown> | null, 'sla_warning')) {
      return reply.send([]);
    }

    const { severity, notified } = request.query as { severity?: string; notified?: string };
    let query = supabase
      .from('sla_events')
      .select(`
        *,
        conversations(id, status, priority, sector_id,
          contacts(display_name, profile_type),
          attendant:users!attendant_id(id, name),
          sectors:sectors!sector_id(id, name)
        )
      `)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (severity) query = query.eq('severity', severity);
    if (notified === 'false') query = query.eq('notified_attendant', false);
    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });

    let rows = data || [];
    const user = request.user as { role?: string; sector_id?: string | null; sector_ids?: string[] };
    if (user.role === 'supervisor') {
      const sids = sectorIdsFromJwt(user);
      if (sids.length) {
        const sidSet = new Set(sids);
        rows = rows.filter((ev: Record<string, unknown>) => {
          const conv = ev.conversations as { sector_id?: string } | null | undefined;
          const sec = conv?.sector_id;
          return Boolean(sec && sidSet.has(sec));
        });
      }
    }

    return reply.send(rows);
  });

  // GET /api/sla/dashboard — resumo de SLA para painel
  app.get('/dashboard', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const now = new Date().toISOString();

    // Conversas abertas com SLA em risco
    const { data: atRisk } = await supabase
      .from('conversations')
      .select('id, priority, sla_first_response_deadline, sla_resolution_deadline, attendant:users!attendant_id(name), contacts(display_name)')
      .eq('workspace_id', workspaceId)
      .in('status', ['open', 'pending'])
      .lt('sla_resolution_deadline', new Date(Date.now() + 30 * 60 * 1000).toISOString()); // próximos 30 min

    // Conversas com SLA vencido
    const { data: breached, count: breachedCount } = await supabase
      .from('conversations')
      .select('id', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .in('status', ['open', 'pending'])
      .lt('sla_resolution_deadline', now)
      .eq('sla_resolved_ok', false);

    return reply.send({ at_risk: atRisk, breached_count: breachedCount, breached_sample: breached });
  });
}
