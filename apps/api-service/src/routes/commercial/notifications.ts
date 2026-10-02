import type { FastifyInstance } from 'fastify';
import { requireWorkspace } from '../../lib/workspaceContext';
import { supabase } from '../../lib/supabase';
import { commercialPre } from './shared';

export async function registerCommercialNotificationRoutes(app: FastifyInstance) {
  app.get('/notifications', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string };
    const q = request.query as { limit?: string };
    const limit = Math.min(50, Math.max(1, Number(q.limit || 30)));

    const { data, error } = await supabase
      .from('commercial_notifications')
      .select('id, type, title, body, entity_type, entity_id, read_at, created_at')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.sub)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return reply.status(500).send({ error: error.message });

    const unread = (data || []).filter((n) => !n.read_at).length;
    return reply.send({ data: data || [], unread_count: unread });
  });

  app.patch('/notifications/:id/read', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string };
    const { id } = request.params as { id: string };
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from('commercial_notifications')
      .update({ read_at: now })
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.sub)
      .eq('id', id)
      .is('read_at', null)
      .select('id, read_at')
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Notificação não encontrada' });
    return reply.send(data);
  });

  app.patch('/notifications/mark-all-read', { preHandler: commercialPre }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string };
    const now = new Date().toISOString();

    const { error } = await supabase
      .from('commercial_notifications')
      .update({ read_at: now })
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.sub)
      .is('read_at', null);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ ok: true, read_at: now });
  });
}
