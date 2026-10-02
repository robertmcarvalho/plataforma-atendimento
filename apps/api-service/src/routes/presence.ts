import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate } from '../middleware/authenticate';
import { requireWorkspace } from '../lib/workspaceContext';
import {
  buildTeamPresence,
  memoryPresenceGet,
  memoryPresenceSet,
  readPresenceMap,
  writePresenceMap,
  type PresenceValue,
} from '../lib/presenceTeam';

const presenceSchema = z.object({
  presence: z.enum(['online', 'offline']),
});

export async function presenceRoutes(app: FastifyInstance) {
  // GET /api/presence/me
  app.get('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string };
    const userId = user.sub;

    try {
      const map = await readPresenceMap(supabase, workspaceId);
      const row = map[userId];
      if (row?.presence) return reply.send(row);
      const mem = memoryPresenceGet(userId);
      return reply.send({ presence: mem || 'online', updated_at: new Date().toISOString() });
    } catch {
      const mem = memoryPresenceGet(userId);
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
    const presence = body.data.presence as PresenceValue;

    try {
      const map = await readPresenceMap(supabase, workspaceId);
      map[userId] = { presence, updated_at };
      await writePresenceMap(supabase, workspaceId, map);
    } catch {
      memoryPresenceSet(userId, presence);
    }

    return reply.send({ presence, updated_at });
  });

  // GET /api/presence/team — presença dos atendentes/gestores do workspace
  app.get('/team', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    const { data: memberships, error: memErr } = await supabase
      .from('workspace_memberships')
      .select('user_id, role_id, roles(name), users!inner(id, name, is_active)')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true);
    if (memErr) return reply.status(500).send({ error: memErr.message });

    const staff: Array<{ id: string; name: string }> = [];
    for (const row of memberships || []) {
      const roles = row.roles as { name?: string } | { name?: string }[] | null;
      const roleName = String((Array.isArray(roles) ? roles[0] : roles)?.name || '').toLowerCase();
      if (roleName !== 'attendant' && roleName !== 'supervisor' && roleName !== 'admin') continue;
      const users = row.users as { id?: string; name?: string; is_active?: boolean } | { id?: string; name?: string; is_active?: boolean }[];
      const user = Array.isArray(users) ? users[0] : users;
      if (!user?.id || user.is_active === false) continue;
      staff.push({ id: String(user.id), name: String(user.name || 'Atendente') });
    }

    staff.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    try {
      const team = await buildTeamPresence(supabase, workspaceId, staff);
      return reply.send(team);
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao carregar presença do time' });
    }
  });
}
