import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate, requireRole } from '../middleware/authenticate';
import { requireWorkspace } from '../lib/workspaceContext';

const templateSchema = z.object({
  name: z.string().min(2),
  category: z.enum(['discount', 'document', 'welcome', 'closing', 'operational', 'leader', 'pharmacy', 'other']),
  body: z.string().min(5),
  variables: z.array(z.string()).default([]),
  meta_template_name: z.string().optional(),
  meta_template_status: z.enum(['draft', 'pending', 'approved', 'rejected', 'paused']).default('draft'),
  meta_template_language: z.string().default('pt_BR'),
  is_active: z.boolean().default(true),
});

export async function templateRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { category, status } = request.query as { category?: string; status?: string };
    let query = supabase
      .from('message_templates')
      .select('*, created_by_user:users!created_by(id, name)')
      .eq('workspace_id', workspaceId)
      .order('name');
    if (category) query = query.eq('category', category);
    if (status) query = query.eq('meta_template_status', status);
    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  app.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase.from('message_templates').select('*').eq('workspace_id', workspaceId).eq('id', id).single();
    if (error) return reply.status(404).send({ error: 'Template não encontrado' });
    return reply.send(data);
  });

  app.post('/', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = templateSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });
    const user = request.user as { sub: string };
    const { data, error } = await supabase
      .from('message_templates').insert({ ...body.data, workspace_id: workspaceId, created_by: user.sub }).select().single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send(data);
  });

  app.put('/:id', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = templateSchema.partial().safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });
    const { data, error } = await supabase
      .from('message_templates').update({ ...body.data, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId).eq('id', id).select().single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  // PATCH /api/templates/:id/meta-status — atualizar status de aprovação Meta
  app.patch('/:id/meta-status', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: string };
    const { data, error } = await supabase
      .from('message_templates')
      .update({ meta_template_status: status, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId).eq('id', id).select().single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  // GET /api/templates/approved — apenas templates aprovados (para campanhas)
  app.get('/list/approved', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { data, error } = await supabase
      .from('message_templates')
      .select('id, name, category, body, variables, meta_template_name, meta_template_language')
      .eq('workspace_id', workspaceId)
      .eq('meta_template_status', 'approved')
      .eq('is_active', true)
      .order('name');
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });
}
