import { createHash, randomBytes } from 'crypto';
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate, requireRole } from '../middleware/authenticate';
import { writeAuditLog } from '../lib/auditLog';
import { requireWorkspace } from '../lib/workspaceContext';

const createSchema = z.object({
  name: z.string().min(2).max(80),
});

export async function apiTokenRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { data, error } = await supabase
      .from('api_tokens')
      .select('id, name, token_prefix, created_at, last_used_at, created_by')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (error) {
      if ((error.message || '').includes('does not exist')) return reply.send([]);
      return reply.status(500).send({ error: error.message });
    }
    return reply.send(data || []);
  });

  app.post('/', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const secret = `sk_${randomBytes(28).toString('base64url')}`;
    const token_hash = createHash('sha256').update(secret).digest('hex');
    const token_prefix = secret.slice(0, 12);
    const actor = (request.user as { sub: string }).sub;

    const { data, error } = await supabase
      .from('api_tokens')
      .insert({
        name: parsed.data.name,
        token_prefix,
        token_hash,
        created_by: actor,
        workspace_id: workspaceId,
      })
      .select('id, name, token_prefix, created_at')
      .single();

    if (error) {
      if ((error.message || '').includes('does not exist')) {
        return reply.status(503).send({ error: 'Tabela api_tokens não aplicada. Execute a migration 011.' });
      }
      return reply.status(500).send({ error: error.message });
    }

    await writeAuditLog({
      actor_id: actor,
      action: 'api_token.create',
      entity_type: 'api_token',
      entity_id: data.id,
      workspace_id: workspaceId,
      metadata: { name: parsed.data.name },
    });

    return reply.status(201).send({ ...data, token: secret });
  });

  app.delete('/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const actor = (request.user as { sub: string }).sub;
    const { error } = await supabase.from('api_tokens').delete().eq('workspace_id', workspaceId).eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });
    await writeAuditLog({
      actor_id: actor,
      action: 'api_token.delete',
      entity_type: 'api_token',
      entity_id: id,
      workspace_id: workspaceId,
    });
    return reply.send({ ok: true });
  });
}
