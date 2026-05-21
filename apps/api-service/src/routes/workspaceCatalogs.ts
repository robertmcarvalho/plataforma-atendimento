import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate, requireRole } from '../middleware/authenticate';
import { buildWorkspaceCatalogDefaults } from '../lib/workspaceCatalogDefaults';
import { requireWorkspace } from '../lib/workspaceContext';
import { normalizeBusinessHours } from '../lib/businessHours';
import { previewSlaDeadlines } from '../lib/slaCalculator';
import { readWorkspaceSetting, upsertWorkspaceSetting } from '../lib/workspaceSettings';

const profileSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

const sectorSchema = z.object({
  sector_key: z.string().min(1),
  sector_id: z.string().uuid().nullable().optional(),
  display_name: z.string().min(1),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
  metadata: z.record(z.unknown()).optional(),
});

const demandKeyRegex = /^[a-z0-9][a-z0-9-]{1,48}$/;

const demandSchema = z.object({
  profile_code: z.string().min(1),
  sector_key: z.string().min(1),
  demand_key: z.string().regex(demandKeyRegex, 'Chave: minúsculas, números e hífen (2–50 caracteres)'),
  title: z.string().min(1),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().default(0),
});

const demandRuleSchema = z.object({
  demand_key: z.string().min(1),
  requires_pharmacy: z.boolean().default(false),
  route_to: z.string().nullable().optional(),
  target_sector_id: z.string().uuid().nullable().optional(),
  metadata: z.record(z.unknown()).default({}),
});

const messageSchema = z.object({
  message_key: z.string().min(1),
  channel: z.string().min(1).default('whatsapp'),
  content: z.string().min(1),
  is_active: z.boolean().default(true),
  metadata: z.record(z.unknown()).default({}),
});

const slaRuleSchema = z.object({
  demand_key: z.string().min(1),
  profile_code: z.string().nullable().optional(),
  settings: z.record(z.unknown()).default({}),
});

const outOfHoursSchema = z.object({
  channel: z.string().min(1).default('whatsapp'),
  is_active: z.boolean().default(false),
  message: z.string().min(1),
  settings: z.record(z.unknown()).default({}),
});

const updateCatalogSchema = z.object({
  profiles: z.array(profileSchema).optional(),
  sectors: z.array(sectorSchema).optional(),
  demands: z.array(demandSchema).optional(),
  demand_rules: z.array(demandRuleSchema).optional(),
  messages: z.array(messageSchema).optional(),
  sla_rules: z.array(slaRuleSchema).optional(),
  out_of_hours: outOfHoursSchema.optional(),
});

type UpdateCatalogBody = z.infer<typeof updateCatalogSchema>;

async function readDemandKeys(workspaceId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('workspace_sector_demands').select('demand_key').eq('workspace_id', workspaceId);
  if (error) throw new Error(error.message);
  return new Set((data || []).map((d) => String(d.demand_key)));
}

async function readProfileCodes(workspaceId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('workspace_profiles').select('code').eq('workspace_id', workspaceId);
  if (error) throw new Error(error.message);
  return new Set((data || []).map((p) => String(p.code)));
}

async function readSectorKeys(workspaceId: string): Promise<Set<string>> {
  const { data, error } = await supabase.from('workspace_visible_sectors').select('sector_key').eq('workspace_id', workspaceId);
  if (error) throw new Error(error.message);
  return new Set((data || []).map((s) => String(s.sector_key)));
}

/** Valida referências cruzadas antes de gravar (demandas ↔ regras / SLA). */
async function assertCatalogConsistency(workspaceId: string, data: UpdateCatalogBody) {
  const demandKeysFromPayload = data.demands ? new Set(data.demands.map((d) => d.demand_key)) : null;
  const effectiveDemandKeys = demandKeysFromPayload ?? (await readDemandKeys(workspaceId));

  const profileSet =
    data.profiles !== undefined ? new Set(data.profiles.map((p) => p.code)) : await readProfileCodes(workspaceId);
  const sectorSet =
    data.sectors !== undefined ? new Set(data.sectors.map((s) => s.sector_key)) : await readSectorKeys(workspaceId);

  if (data.demands) {
    for (const d of data.demands) {
      if (!profileSet.has(d.profile_code)) {
        throw new Error(`Demanda ${d.demand_key}: profile_code "${d.profile_code}" não existe no workspace (inclua o perfil no mesmo save ou crie antes).`);
      }
      if (!sectorSet.has(d.sector_key)) {
        throw new Error(`Demanda ${d.demand_key}: sector_key "${d.sector_key}" não existe no workspace.`);
      }
    }
  }

  if (data.demand_rules) {
    for (const r of data.demand_rules) {
      if (!effectiveDemandKeys.has(r.demand_key)) {
        throw new Error(`demand_rules: demand_key "${r.demand_key}" não existe nas demandas enviadas/gravadas.`);
      }
    }
  }

  if (data.sla_rules) {
    const profileCodesForSla =
      data.profiles !== undefined ? new Set(data.profiles.map((p) => p.code)) : await readProfileCodes(workspaceId);
    for (const r of data.sla_rules) {
      if (!effectiveDemandKeys.has(r.demand_key)) {
        throw new Error(`sla_rules: demand_key "${r.demand_key}" não existe nas demandas enviadas/gravadas.`);
      }
      const pc = r.profile_code != null && String(r.profile_code).trim() !== '' ? String(r.profile_code).trim() : null;
      if (pc && !profileCodesForSla.has(pc)) {
        throw new Error(`sla_rules: profile_code "${pc}" inválido para esta workspace.`);
      }
    }
  }
}

async function seedWorkspaceCatalogDefaults(workspaceId: string) {
  const { count, error } = await supabase
    .from('workspace_profiles')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);
  if (error) throw new Error(error.message);
  if ((count || 0) > 0) return;

  const defaults = buildWorkspaceCatalogDefaults();
  const outOfHoursSetting = await readWorkspaceSetting(workspaceId, 'auto_reply_out_of_hours');
  const outOfHoursMessage =
    typeof outOfHoursSetting === 'string' && outOfHoursSetting.trim().length > 0
      ? outOfHoursSetting
      : defaults.outOfHours.message;

  await supabase.from('workspace_profiles').insert(
    defaults.profiles.map((item) => ({ workspace_id: workspaceId, ...item }))
  );
  await supabase.from('workspace_visible_sectors').insert(
    defaults.sectors.map((item) => ({ workspace_id: workspaceId, ...item, is_active: true }))
  );
  await supabase.from('workspace_sector_demands').insert(
    defaults.demands.map((item) => ({ workspace_id: workspaceId, ...item, is_active: true }))
  );
  await supabase.from('workspace_demand_rules').insert(
    defaults.demandRules.map((item) => ({
      workspace_id: workspaceId,
      demand_key: item.demand_key,
      requires_pharmacy: item.requires_pharmacy,
      metadata: item.metadata || {},
    }))
  );
  await supabase.from('workspace_flow_messages').insert(
    defaults.messages.map((item) => ({
      workspace_id: workspaceId,
      message_key: item.message_key,
      channel: item.channel,
      content: item.content,
      is_active: true,
      metadata: item.metadata || {},
    }))
  );
  await supabase.from('workspace_sla_rules').insert(
    defaults.slaRules.map((item) => ({
      workspace_id: workspaceId,
      demand_key: item.demand_key,
      profile_code: item.profile_code || null,
      settings: item.settings,
    }))
  );
  await supabase.from('workspace_out_of_hours_rules').upsert(
    {
      workspace_id: workspaceId,
      channel: defaults.outOfHours.channel,
      is_active: defaults.outOfHours.is_active,
      message: outOfHoursMessage,
      settings: defaults.outOfHours.settings,
    },
    { onConflict: 'workspace_id,channel' }
  );

  const { data: existingFlow } = await supabase
    .from('conversation_flow_definitions')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('slug', 'guided-intake')
    .maybeSingle();
  if (!existingFlow?.id) {
    const { data: definition } = await supabase
      .from('conversation_flow_definitions')
      .insert({
        workspace_id: workspaceId,
        slug: 'guided-intake',
        name: 'Triagem guiada',
        description: 'Fluxo padrão perfil → setor → demanda → farmácia → roteamento',
      })
      .select('id')
      .single();
    if (definition?.id) {
      await supabase.from('conversation_flow_versions').insert({
        workspace_id: workspaceId,
        definition_id: definition.id,
        version_number: 1,
        status: 'published',
        graph: {
          nodes: [
            { id: 'start', type: 'start', label: 'Início' },
            { id: 'profile', type: 'profile', label: 'Perfil' },
            { id: 'sector', type: 'sector', label: 'Setor' },
            { id: 'demand', type: 'demand', label: 'Demanda' },
            { id: 'route', type: 'route', label: 'Roteamento' },
          ],
          edges: [
            { from: 'start', to: 'profile' },
            { from: 'profile', to: 'sector' },
            { from: 'sector', to: 'demand' },
            { from: 'demand', to: 'route' },
          ],
        },
        validation: { valid: true, issues: [] },
        published_at: new Date().toISOString(),
      });
    }
  }
}

async function loadCatalogSnapshot(workspaceId: string) {
  await seedWorkspaceCatalogDefaults(workspaceId);

  const [profiles, sectors, demands, demandRules, messages, slaRules, outOfHours] = await Promise.all([
    supabase.from('workspace_profiles').select('*').eq('workspace_id', workspaceId).order('sort_order').order('label'),
    supabase.from('workspace_visible_sectors').select('*').eq('workspace_id', workspaceId).order('sort_order').order('display_name'),
    supabase.from('workspace_sector_demands').select('*').eq('workspace_id', workspaceId).order('sort_order').order('title'),
    supabase.from('workspace_demand_rules').select('*').eq('workspace_id', workspaceId).order('demand_key'),
    supabase.from('workspace_flow_messages').select('*').eq('workspace_id', workspaceId).order('message_key'),
    supabase.from('workspace_sla_rules').select('*').eq('workspace_id', workspaceId).order('demand_key'),
    supabase.from('workspace_out_of_hours_rules').select('*').eq('workspace_id', workspaceId).order('channel').limit(10),
  ]);

  for (const result of [profiles, sectors, demands, demandRules, messages, slaRules, outOfHours]) {
    if (result.error) throw new Error(result.error.message);
  }

  return {
    profiles: profiles.data || [],
    sectors: sectors.data || [],
    demands: demands.data || [],
    demand_rules: demandRules.data || [],
    messages: messages.data || [],
    sla_rules: slaRules.data || [],
    out_of_hours: (outOfHours.data || [])[0] || null,
  };
}

export async function workspaceCatalogRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    try {
      return reply.send(await loadCatalogSnapshot(workspaceId));
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Falha ao carregar catálogos' });
    }
  });

  app.put('/', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    const body = updateCatalogSchema.safeParse(request.body || {});
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    try {
      await seedWorkspaceCatalogDefaults(workspaceId);
      await assertCatalogConsistency(workspaceId, body.data);

      if (body.data.profiles) {
        const { error } = await supabase.from('workspace_profiles').upsert(
          body.data.profiles.map((item) => ({ workspace_id: workspaceId, ...item, updated_at: new Date().toISOString() })),
          { onConflict: 'workspace_id,code' }
        );
        if (error) throw new Error(error.message);
      }

      if (body.data.sectors) {
        const { error } = await supabase.from('workspace_visible_sectors').upsert(
          body.data.sectors.map((item) => ({ workspace_id: workspaceId, ...item, updated_at: new Date().toISOString() })),
          { onConflict: 'workspace_id,sector_key' }
        );
        if (error) throw new Error(error.message);
      }

      if (body.data.demands) {
        const { error } = await supabase.from('workspace_sector_demands').upsert(
          body.data.demands.map((item) => ({ workspace_id: workspaceId, ...item, updated_at: new Date().toISOString() })),
          { onConflict: 'workspace_id,demand_key' }
        );
        if (error) throw new Error(error.message);
      }

      if (body.data.demand_rules) {
        const { error } = await supabase.from('workspace_demand_rules').upsert(
          body.data.demand_rules.map((item) => ({ workspace_id: workspaceId, ...item, updated_at: new Date().toISOString() })),
          { onConflict: 'workspace_id,demand_key' }
        );
        if (error) throw new Error(error.message);
      }

      if (body.data.messages) {
        const { error } = await supabase.from('workspace_flow_messages').upsert(
          body.data.messages.map((item) => ({ workspace_id: workspaceId, ...item, updated_at: new Date().toISOString() })),
          { onConflict: 'workspace_id,message_key,channel' }
        );
        if (error) throw new Error(error.message);
      }

      if (body.data.sla_rules) {
        for (const item of body.data.sla_rules) {
          const { error } = await supabase.from('workspace_sla_rules').upsert(
            {
              workspace_id: workspaceId,
              demand_key: item.demand_key,
              profile_code: item.profile_code || null,
              settings: item.settings,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'workspace_id,demand_key,profile_code' }
          );
          if (error) throw new Error(error.message);
        }
      }

      if (body.data.out_of_hours) {
        const { error } = await supabase.from('workspace_out_of_hours_rules').upsert(
          {
            workspace_id: workspaceId,
            channel: body.data.out_of_hours.channel,
            is_active: body.data.out_of_hours.is_active,
            message: body.data.out_of_hours.message,
            settings: body.data.out_of_hours.settings,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'workspace_id,channel' }
        );
        if (error) throw new Error(error.message);
        await upsertWorkspaceSetting(workspaceId, 'auto_reply_out_of_hours', body.data.out_of_hours.message);
      }

      return reply.send(await loadCatalogSnapshot(workspaceId));
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Falha ao salvar catálogos' });
    }
  });

  app.get('/export', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    try {
      const snapshot = await loadCatalogSnapshot(workspaceId);
      return reply.send({ workspace_id: workspaceId, exported_at: new Date().toISOString(), ...snapshot });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Falha ao exportar catálogos' });
    }
  });

  app.post('/import', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = updateCatalogSchema.safeParse(request.body || {});
    if (!body.success) return reply.status(400).send({ error: 'Payload inválido', details: body.error.flatten() });
    try {
      await seedWorkspaceCatalogDefaults(workspaceId);
      await assertCatalogConsistency(workspaceId, body.data);
      if (body.data.profiles) {
        const { error } = await supabase.from('workspace_profiles').upsert(
          body.data.profiles.map((item) => ({ workspace_id: workspaceId, ...item, updated_at: new Date().toISOString() })),
          { onConflict: 'workspace_id,code' }
        );
        if (error) throw new Error(error.message);
      }
      if (body.data.sectors) {
        const { error } = await supabase.from('workspace_visible_sectors').upsert(
          body.data.sectors.map((item) => ({ workspace_id: workspaceId, ...item, updated_at: new Date().toISOString() })),
          { onConflict: 'workspace_id,sector_key' }
        );
        if (error) throw new Error(error.message);
      }
      if (body.data.demands) {
        const { error } = await supabase.from('workspace_sector_demands').upsert(
          body.data.demands.map((item) => ({ workspace_id: workspaceId, ...item, updated_at: new Date().toISOString() })),
          { onConflict: 'workspace_id,demand_key' }
        );
        if (error) throw new Error(error.message);
      }
      if (body.data.demand_rules) {
        const { error } = await supabase.from('workspace_demand_rules').upsert(
          body.data.demand_rules.map((item) => ({ workspace_id: workspaceId, ...item, updated_at: new Date().toISOString() })),
          { onConflict: 'workspace_id,demand_key' }
        );
        if (error) throw new Error(error.message);
      }
      if (body.data.messages) {
        const { error } = await supabase.from('workspace_flow_messages').upsert(
          body.data.messages.map((item) => ({ workspace_id: workspaceId, ...item, updated_at: new Date().toISOString() })),
          { onConflict: 'workspace_id,message_key,channel' }
        );
        if (error) throw new Error(error.message);
      }
      if (body.data.sla_rules) {
        for (const item of body.data.sla_rules) {
          const { error } = await supabase.from('workspace_sla_rules').upsert(
            {
              workspace_id: workspaceId,
              demand_key: item.demand_key,
              profile_code: item.profile_code || null,
              settings: item.settings,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'workspace_id,demand_key,profile_code' }
          );
          if (error) throw new Error(error.message);
        }
      }
      if (body.data.out_of_hours) {
        const { error } = await supabase.from('workspace_out_of_hours_rules').upsert(
          {
            workspace_id: workspaceId,
            channel: body.data.out_of_hours.channel,
            is_active: body.data.out_of_hours.is_active,
            message: body.data.out_of_hours.message,
            settings: body.data.out_of_hours.settings,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'workspace_id,channel' }
        );
        if (error) throw new Error(error.message);
        await upsertWorkspaceSetting(workspaceId, 'auto_reply_out_of_hours', body.data.out_of_hours.message);
      }
      return reply.send(await loadCatalogSnapshot(workspaceId));
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Falha ao importar catálogos' });
    }
  });

  app.post('/simulate-intake', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    const body = z
      .object({
        channel_id: z.string().uuid().optional().or(z.literal('')),
        profile_code: z.string().min(1),
        sector_key: z.string().min(1),
        demand_key: z.string().min(1),
      })
      .safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    try {
      const channelQuery = supabase
        .from('workspace_channels')
        .select('id, display_name, channel_type, config')
        .eq('workspace_id', workspaceId)
        .eq('is_active', true);
      const channelRes = body.data.channel_id ? await channelQuery.eq('id', body.data.channel_id) : await channelQuery.limit(1);
      const channel = channelRes.data?.[0] as { id: string; display_name?: string | null; channel_type?: string; config?: Record<string, unknown> } | undefined;
      const chConfig = channel?.config && typeof channel.config === 'object' ? channel.config : null;
      if (chConfig) {
        const sectors = Array.isArray(chConfig.sectors) ? (chConfig.sectors as Record<string, unknown>[]) : [];
        const demands = Array.isArray(chConfig.demands) ? (chConfig.demands as Record<string, unknown>[]) : [];
        const messages = chConfig.messages && typeof chConfig.messages === 'object' ? (chConfig.messages as Record<string, unknown>) : {};
        const slaDefault = chConfig.sla && typeof chConfig.sla === 'object' ? (chConfig.sla as Record<string, unknown>) : {};
        const sector = sectors.find((s) => String(s.id || s.sector_id) === body.data.sector_key && s.is_active !== false);
        const demand = demands.find(
          (d) =>
            String(d.id || d.demand_key) === body.data.demand_key &&
            d.is_active !== false &&
            Array.isArray(d.sector_ids) &&
            d.sector_ids.map(String).includes(body.data.sector_key)
        );
        if (sector && demand) {
          const slaOverride = demand.sla_override && typeof demand.sla_override === 'object' ? (demand.sla_override as Record<string, unknown>) : {};
          const slaSettings = { ...slaDefault, ...slaOverride };
          const messageRows = [
            ['greeting', messages.greeting],
            ['auto_reply_out_of_hours', messages.out_of_hours],
            ['queue_full', messages.queue_full],
          ]
            .map(([message_key, content]) => ({ message_key: String(message_key), content: String(content || '').trim() }))
            .filter((m) => m.content);
          const channelLabel = channel?.display_name || channel?.channel_type || channel?.id || 'webhook';
          const trace = [
            `canal: ${channelLabel}`,
            `perfil: ${body.data.profile_code}`,
            `setor: ${String(sector.id || sector.sector_id)} (${String(sector.name || '')})`,
            `demanda: ${String(demand.id || demand.demand_key)} (${String(demand.title || demand.name || '')})`,
            demand.requires_pharmacy ? 'farmácia: exigida pela demanda do webhook' : 'farmácia: não exigida',
            'handoff: SLA do webhook aplicado',
          ];
          const sla = previewSlaDeadlines({
            first_response_sla_minutes: Number(slaSettings.first_response_sla_minutes) || undefined,
            treatment_sla_minutes: Number(slaSettings.treatment_sla_minutes) || undefined,
            resolution_sla_minutes: Number(slaSettings.resolution_sla_minutes) || undefined,
            use_business_hours: slaSettings.use_business_hours !== false,
          });
          return reply.send({ trace, messages: messageRows, sla });
        }
      }

      const snapshot = await loadCatalogSnapshot(workspaceId);
      const profile = snapshot.profiles.find((p) => p.code === body.data.profile_code && p.is_active);
      const sector = snapshot.sectors.find((s) => s.sector_key === body.data.sector_key && s.is_active);
      const demand = snapshot.demands.find(
        (d) =>
          d.demand_key === body.data.demand_key &&
          d.profile_code === body.data.profile_code &&
          d.sector_key === body.data.sector_key &&
          d.is_active
      );
      if (!profile) return reply.status(400).send({ error: 'Perfil inválido ou inativo' });
      if (!sector) return reply.status(400).send({ error: 'Setor inválido ou inativo' });
      if (!demand) return reply.status(400).send({ error: 'Demanda inválida para perfil/setor' });

      const rule = snapshot.demand_rules.find((r) => r.demand_key === body.data.demand_key);
      const messageByKey = new Map(
        (snapshot.messages || [])
          .filter((m) => m.is_active !== false)
          .map((m) => [m.message_key, m.content] as const)
      );
      const resolveMessage = (key: string) => {
        const content = messageByKey.get(key);
        return content ? { message_key: key, content } : null;
      };

      const trace: string[] = [];
      const messages: Array<{ message_key: string; content: string }> = [];

      const pushMsg = (key: string, label: string) => {
        const m = resolveMessage(key);
        trace.push(label);
        if (m) messages.push(m);
        else trace.push(`(mensagem ausente: ${key})`);
      };

      if (snapshot.out_of_hours?.is_active) {
        trace.push('fora_do_horario: ativo (mensagem aplicada se fechado)');
        const ooh = snapshot.out_of_hours.message?.trim();
        if (ooh) messages.push({ message_key: 'auto_reply_out_of_hours', content: ooh });
      }

      pushMsg('driver_greeting_list', `boas_vindas → perfil ${profile.label}`);
      trace.push(`perfil: ${profile.code} (${profile.label})`);
      trace.push(`setor: ${sector.sector_key} (${sector.display_name})`);
      trace.push(`demanda: ${demand.demand_key} (${demand.title})`);

      if (rule?.requires_pharmacy) {
        pushMsg('ask_pharmacy_numbered', 'farmácia: escolha numerada');
      }

      if (body.data.profile_code === 'driver') {
        pushMsg('ask_driver_name', 'coleta: nome');
        pushMsg('ask_driver_city', 'coleta: cidade');
      }

      trace.push('handoff: SLA da demanda aplicado');

      const slaRule = snapshot.sla_rules.find((r) => r.demand_key === body.data.demand_key);
      const sectorMeta =
        sector.metadata && typeof sector.metadata === 'object' ? (sector.metadata as Record<string, unknown>) : {};
      const sectorDefault = sectorMeta.sla_default as Record<string, unknown> | undefined;
      const slaSettings = (slaRule?.settings as Record<string, unknown> | undefined) || sectorDefault || {};

      const sla = previewSlaDeadlines({
        first_response_sla_minutes: Number(slaSettings.first_response_sla_minutes) || undefined,
        treatment_sla_minutes: Number(slaSettings.treatment_sla_minutes) || undefined,
        resolution_sla_minutes: Number(slaSettings.resolution_sla_minutes) || undefined,
        use_business_hours: slaSettings.use_business_hours !== false,
      });

      return reply.send({ trace, messages, sla });
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Falha na simulação' });
    }
  });

  app.post('/sla-rules/preview', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = z
      .object({
        first_response_sla_minutes: z.number().int().positive().optional(),
        treatment_sla_minutes: z.number().int().positive().optional(),
        resolution_sla_minutes: z.number().int().positive().optional(),
        use_business_hours: z.boolean().optional(),
        business_hours: z.record(z.unknown()).optional(),
      })
      .safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const bh =
      body.data.use_business_hours !== false && body.data.business_hours
        ? normalizeBusinessHours(body.data.business_hours)
        : null;

    return reply.send(
      previewSlaDeadlines(
        {
          first_response_sla_minutes: body.data.first_response_sla_minutes,
          treatment_sla_minutes: body.data.treatment_sla_minutes,
          resolution_sla_minutes: body.data.resolution_sla_minutes,
          use_business_hours: body.data.use_business_hours,
        },
        bh
      )
    );
  });
}
