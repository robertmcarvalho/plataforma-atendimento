import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate, requireRole } from '../middleware/authenticate';
import { requireCadastroManage } from '../lib/permissions';
import { demoteLeaderStructural } from '../lib/leaderStructuralDemotion';
import { buildPharmaciesWithDriversForLeader } from '../lib/leaderPortalScope';
import { normalizeNameLike } from '../lib/textNormalization';
import { requireWorkspace } from '../lib/workspaceContext';
import { buildCadastroSearchOrFilter, LEADER_SEARCH_CONFIG } from '../lib/cadastroSearch';

const leaderSchema = z.object({
  name: z.string().min(2),
  phone: z.string().min(10),
  email: z.string().email().optional(),
  user_id: z.string().uuid().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  status: z.enum(['active', 'inactive']).default('active'),
  notes: z.string().optional(),
});

function startOfDaysAgoIso(days: number) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

export async function leaderRoutes(app: FastifyInstance) {
  // GET /api/leaders/summary — lista com vínculos + SLA (best-effort)
  app.get('/summary', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { search, status, sla_days = '30' } = request.query as Record<string, string>;
    const slaDays = Math.max(1, Math.min(90, Number(sla_days) || 30));
    const sinceSla = startOfDaysAgoIso(slaDays);

    let query = supabase
      .from('leaders')
      .select(`*, leader_pharmacy_links(pharmacy_id, is_active, pharmacies(id, trade_name))`)
      .eq('workspace_id', workspaceId)
      .order('name');

    if (status) query = query.eq('status', status);
    if (search) {
      const orFilter = buildCadastroSearchOrFilter(search, LEADER_SEARCH_CONFIG);
      if (orFilter) query = query.or(orFilter);
    }

    const { data: leaders, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });

    const leaderIds = (leaders || []).map((l) => l.id).filter(Boolean);
    const pharmaciesManaged = new Set<string>();
    for (const l of (leaders || []) as Array<any>) {
      const links = (l.leader_pharmacy_links || []) as Array<any>;
      for (const link of links) {
        if (link?.is_active && link?.pharmacy_id) pharmaciesManaged.add(String(link.pharmacy_id));
      }
    }

    const [linkedPharmaciesByFk, { count: attendantsTotal }, { count: driversTotal }, slaConvs] = await Promise.all([
      leaderIds.length
        ? supabase.from('pharmacies').select('id, trade_name, leader_id').eq('workspace_id', workspaceId).in('leader_id', leaderIds).limit(20000)
        : Promise.resolve({ data: [] as any[] }),
      supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'attendant'),
      supabase
        .from('drivers')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('status', 'active')
        .not('override_leader_id', 'is', null),
      leaderIds.length
        ? supabase
            .from('conversations')
            .select('context_leader_id, sla_resolved_ok')
            .eq('workspace_id', workspaceId)
            .in('context_leader_id', leaderIds)
            .gte('created_at', sinceSla)
            .not('sla_resolved_ok', 'is', null)
            .limit(20000)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const slaOk = new Map<string, number>();
    const slaTotal = new Map<string, number>();
    for (const r of (slaConvs.data || []) as Array<{ context_leader_id?: string; sla_resolved_ok?: boolean }>) {
      const id = r.context_leader_id;
      if (!id) continue;
      slaTotal.set(id, (slaTotal.get(id) || 0) + 1);
      if (r.sla_resolved_ok === true) slaOk.set(id, (slaOk.get(id) || 0) + 1);
    }

    const pharmaciesByLeader = new Map<string, Array<{ id: string; trade_name: string }>>();
    for (const p of (linkedPharmaciesByFk.data || []) as Array<{ id: string; trade_name: string; leader_id: string }>) {
      const list = pharmaciesByLeader.get(p.leader_id) || [];
      list.push({ id: p.id, trade_name: p.trade_name });
      pharmaciesByLeader.set(p.leader_id, list);
      pharmaciesManaged.add(String(p.id));
    }

    const enriched = (leaders || []).map((l: any) => {
      const links = (l.leader_pharmacy_links || []) as Array<any>;
      const activeLinks = links.filter((x) => x?.is_active);
      const linkNames = activeLinks
        .map((x) => (Array.isArray(x.pharmacies) ? x.pharmacies[0] : x.pharmacies)?.trade_name)
        .filter(Boolean);
      const fkNames = (pharmaciesByLeader.get(l.id) || []).map((p) => p.trade_name).filter(Boolean);
      const pharmacyNames = Array.from(new Set([...linkNames, ...fkNames]));
      const total = slaTotal.get(l.id) || 0;
      const ok = slaOk.get(l.id) || 0;
      const slaPercent = total > 0 ? Math.round((ok / total) * 1000) / 10 : 0;
      return {
        ...l,
        pharmacies_managed: pharmacyNames,
        pharmacies_count: pharmacyNames.length,
        sla_percent: slaPercent,
        csat: null,
        sla_days: slaDays,
      };
    });

    const slaAvg = enriched.length ? Math.round((enriched.reduce((acc: number, l: any) => acc + Number(l.sla_percent || 0), 0) / enriched.length) * 10) / 10 : 0;
    const activeLeaders = enriched.filter((l: any) => l.status === 'active').length;

    return reply.send({
      totals: {
        leaders_active: activeLeaders,
        pharmacies_managed: pharmaciesManaged.size,
        attendants_total: attendantsTotal || 0,
        drivers_total: driversTotal || 0,
        team_total: (attendantsTotal || 0) + (driversTotal || 0),
        sla_avg_percent: slaAvg,
      },
      leaders: enriched,
    });
  });

  // GET /api/leaders
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { search, status } = request.query as { search?: string; status?: string };
    let query = supabase
      .from('leaders')
      .select(`*, leader_pharmacy_links(pharmacy_id, is_active, pharmacies(id, trade_name))`)
      .eq('workspace_id', workspaceId)
      .order('name');
    if (status) query = query.eq('status', status);
    if (search) {
      const orFilter = buildCadastroSearchOrFilter(search, LEADER_SEARCH_CONFIG);
      if (orFilter) query = query.or(orFilter);
    }
    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  // GET /api/leaders/:id
  app.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('leaders')
      .select(
        `
        *,
        leader_pharmacy_links(
          id, is_active,
          pharmacies(id, trade_name, city)
        )
      `
      )
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();
    if (error) return reply.status(404).send({ error: 'Líder não encontrado' });

    const pharmacies_with_drivers = await buildPharmaciesWithDriversForLeader(supabase, id);
    return reply.send({ ...data, pharmacies_with_drivers });
  });

  // POST /api/leaders
  app.post('/', { preHandler: [authenticate, requireCadastroManage('leaders')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = leaderSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });
    const row = { workspace_id: workspaceId, ...body.data, name: normalizeNameLike(body.data.name) || body.data.name };
    const { data, error } = await supabase.from('leaders').insert({ ...row, workspace_id: workspaceId }).select().single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send(data);
  });

  // PUT /api/leaders/:id
  app.put('/:id', { preHandler: [authenticate, requireCadastroManage('leaders')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = leaderSchema.partial().safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    if (body.data.status === 'inactive') {
      await demoteLeaderStructural(supabase, id);
    }

    const updates = {
      ...body.data,
      name: body.data.name !== undefined ? normalizeNameLike(body.data.name) : undefined,
    };
    const { data, error } = await supabase
      .from('leaders')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  // POST /api/leaders/:id/pharmacies — vincular farmácia
  app.post('/:id/pharmacies', { preHandler: [authenticate, requireCadastroManage('leaders')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { pharmacy_id } = request.body as { pharmacy_id: string };
    const { error: pharmacyUpdateErr } = await supabase
      .from('pharmacies')
      .update({ leader_id: id, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', pharmacy_id);
    if (pharmacyUpdateErr) return reply.status(500).send({ error: pharmacyUpdateErr.message });

    const { error: deactivateOthersErr } = await supabase
      .from('leader_pharmacy_links')
      .update({ is_active: false })
      .eq('workspace_id', workspaceId)
      .eq('pharmacy_id', pharmacy_id)
      .neq('leader_id', id);
    if (deactivateOthersErr) return reply.status(500).send({ error: deactivateOthersErr.message });

    const { data, error } = await supabase
      .from('leader_pharmacy_links')
      .upsert({ workspace_id: workspaceId, leader_id: id, pharmacy_id, is_active: true }, { onConflict: 'leader_id,pharmacy_id' })
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send(data);
  });

  // DELETE /api/leaders/:id/pharmacies/:pharmacyId — desvincular farmácia
  app.delete('/:id/pharmacies/:pharmacyId', { preHandler: [authenticate, requireCadastroManage('leaders')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id, pharmacyId } = request.params as { id: string; pharmacyId: string };
    const { error } = await supabase
      .from('leader_pharmacy_links')
      .update({ is_active: false })
      .eq('workspace_id', workspaceId)
      .eq('leader_id', id)
      .eq('pharmacy_id', pharmacyId);
    if (error) return reply.status(500).send({ error: error.message });

    const { data: pharmacy } = await supabase.from('pharmacies').select('leader_id').eq('workspace_id', workspaceId).eq('id', pharmacyId).maybeSingle();
    if (pharmacy?.leader_id === id) {
      const { error: clearErr } = await supabase
        .from('pharmacies')
        .update({ leader_id: null, updated_at: new Date().toISOString() })
        .eq('workspace_id', workspaceId)
        .eq('id', pharmacyId);
      if (clearErr) return reply.status(500).send({ error: clearErr.message });
    }

    return reply.status(204).send();
  });
}
