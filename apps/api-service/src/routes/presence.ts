import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate } from '../middleware/authenticate';
import { requireWorkspace } from '../lib/workspaceContext';

const presenceSchema = z.object({
  presence: z.enum(['online', 'offline']),
});

type PresenceValue = z.infer<typeof presenceSchema>['presence'];

const MEMORY_PRESENCE = new Map<string, PresenceValue>();
const SETTING_KEY = 'user_presence';

async function readPresenceMap(workspaceId: string): Promise<Record<string, { presence: PresenceValue; updated_at: string }>> {
  const { data, error } = await supabase.from('app_settings').select('value').eq('workspace_id', workspaceId).eq('key', SETTING_KEY).single();

  if (error) {
    if ((error.message || '').includes('app_settings') && (error.message || '').includes('does not exist')) {
      return {};
    }
    // If key doesn't exist yet, treat as empty map.
    if ((error.message || '').toLowerCase().includes('0 rows')) return {};
    return {};
  }

  const value = (data as any)?.value;
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, { presence: PresenceValue; updated_at: string }>;
}

async function writePresenceMap(workspaceId: string, map: Record<string, { presence: PresenceValue; updated_at: string }>) {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ workspace_id: workspaceId, key: SETTING_KEY, value: map, updated_at: new Date().toISOString() }, { onConflict: 'workspace_id,key' })
    .select()
    .single();

  if (error) {
    if ((error.message || '').includes('app_settings') && (error.message || '').includes('does not exist')) {
      return;
    }
    throw error;
  }
}

export async function presenceRoutes(app: FastifyInstance) {
  // GET /api/presence/me
  app.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string };
    const userId = user.sub;

    try {
      const map = await readPresenceMap(workspaceId);
      const row = map[userId];
      if (row?.presence) return reply.send(row);
      const mem = MEMORY_PRESENCE.get(userId);
      return reply.send({ presence: mem || 'online', updated_at: new Date().toISOString() });
    } catch {
      const mem = MEMORY_PRESENCE.get(userId);
      return reply.send({ presence: mem || 'online', updated_at: new Date().toISOString() });
    }
  });

  // PUT /api/presence/me
  app.put('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string };
    const userId = user.sub;

    const body = presenceSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const updated_at = new Date().toISOString();
    const presence = body.data.presence;

    try {
      const map = await readPresenceMap(workspaceId);
      map[userId] = { presence, updated_at };
      await writePresenceMap(workspaceId, map);
    } catch {
      MEMORY_PRESENCE.set(userId, presence);
    }

    return reply.send({ presence, updated_at });
  });
}

