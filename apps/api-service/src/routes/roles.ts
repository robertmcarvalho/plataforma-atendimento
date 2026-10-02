import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate, requireRole } from '../middleware/authenticate';
import { writeAuditLog } from '../lib/auditLog';
import { requireWorkspace } from '../lib/workspaceContext';
import { ensureCommercialRoles } from '../lib/commercial/commercialRoles';

const patchRoleSchema = z.object({
  permissions: z.record(z.unknown()),
});

export async function roleRoutes(app: FastifyInstance) {
  // GET /api/roles
  app.get('/', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    await ensureCommercialRoles(workspaceId);
    const { data, error } = await supabase.from('roles').select('id, name, permissions').eq('workspace_id', workspaceId).order('name');
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data || []);
  });

  app.patch('/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const parsed = patchRoleSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const actor = (request.user as { sub: string }).sub;
    const { data, error } = await supabase
      .from('roles')
      .update({ permissions: parsed.data.permissions })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select('id, name, permissions')
      .single();

    if (error) return reply.status(500).send({ error: error.message });

    await writeAuditLog({
      actor_id: actor,
      action: 'role.patch',
      entity_type: 'role',
      entity_id: id,
      metadata: { name: data?.name },
    });

    return reply.send(data);
  });
}

