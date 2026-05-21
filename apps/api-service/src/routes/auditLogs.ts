import { FastifyInstance } from 'fastify';
import { supabase } from '../lib/supabase';
import { authenticate, requireRole } from '../middleware/authenticate';
import { requireWorkspace } from '../lib/workspaceContext';

export async function auditLogRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const q = request.query as { limit?: string; offset?: string };
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 40));
    const offset = Math.max(0, Number(q.offset) || 0);

    const { data, error } = await supabase
      .from('audit_logs')
      .select('id, actor_id, action, entity_type, entity_id, metadata, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      if ((error.message || '').includes('does not exist')) return reply.send({ items: [], limit, offset });
      return reply.status(500).send({ error: error.message });
    }
    return reply.send({ items: data || [], limit, offset });
  });
}
