import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { compileFlowGraphToV2, isSkeletonFlowGraph } from '@plataforma/channel-runtime';
import { supabase } from '../lib/supabase';
import {
  simulateLegacyTrace,
  simulateV2Trace,
  validateConversationFlowGraph,
  type GraphFormat,
  type SimulateInputV2,
} from '../lib/conversationFlowGraph';
import { authenticate, requireRole } from '../middleware/authenticate';
import { requireWorkspace } from '../lib/workspaceContext';
import { readWorkspaceSetting, upsertWorkspaceSetting } from '../lib/workspaceSettings';

const definitionSchema = z.object({
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/),
  name: z.string().min(2),
  description: z.string().optional().nullable(),
  initial_graph: z.unknown().optional(),
});

const versionSchema = z.object({
  graph: z.unknown(),
});

const simulateSchema = z.object({
  version_id: z.string().uuid().optional(),
  input: z.record(z.unknown()).default({}),
});

const bindingSchema = z.object({
  workspace_channel_id: z.string().uuid().nullable().optional(),
  trigger_type: z
    .enum(['conversation_started', 'message_received', 'keyword', 'conversation_resolved'])
    .default('message_received'),
  keywords: z.array(z.string()).default([]),
  priority: z.number().int().default(0),
  is_active: z.boolean().default(true),
});

function parseSimulateInput(raw: Record<string, unknown>): SimulateInputV2 {
  const choice_by_node =
    raw.choice_by_node && typeof raw.choice_by_node === 'object' && !Array.isArray(raw.choice_by_node)
      ? (raw.choice_by_node as Record<string, string>)
      : undefined;
  const variable_values =
    raw.variable_values && typeof raw.variable_values === 'object' && !Array.isArray(raw.variable_values)
      ? Object.fromEntries(
          Object.entries(raw.variable_values as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])
        )
      : undefined;
  return {
    choice_by_node,
    variable_values,
    text_sample: typeof raw.text_sample === 'string' ? raw.text_sample : undefined,
    identify_branch_key: typeof raw.identify_branch_key === 'string' ? raw.identify_branch_key : undefined,
  };
}

async function getPublishedVersion(workspaceId: string, definitionId: string) {
  const { data } = await supabase
    .from('conversation_flow_versions')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('definition_id', definitionId)
    .eq('status', 'published')
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function conversationFlowRoutes(app: FastifyInstance) {
  app.get('/runtime-mode', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const mode = String((await readWorkspaceSetting(workspaceId, 'flow_runtime_mode')) || 'catalog');
    return reply.send({ workspace_id: workspaceId, mode });
  });

  app.put('/runtime-mode', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = z.object({ mode: z.enum(['legacy', 'shadow', 'catalog', 'flow']) }).safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Modo inválido' });
    await upsertWorkspaceSetting(workspaceId, 'flow_runtime_mode', body.data.mode);
    return reply.send({ workspace_id: workspaceId, mode: body.data.mode });
  });

  app.get('/definitions', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { data, error } = await supabase
      .from('conversation_flow_definitions')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('name');
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data || []);
  });

  const definitionPatchSchema = z.object({
    name: z.string().min(2).max(200).optional(),
    description: z.string().max(4000).nullable().optional(),
    is_active: z.boolean().optional(),
  });

  app.patch('/definitions/:id', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = definitionPatchSchema.safeParse(request.body || {});
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });
    if (Object.keys(body.data).length === 0) {
      return reply.status(400).send({ error: 'Nenhum campo para atualizar' });
    }

    const { data: existing } = await supabase
      .from('conversation_flow_definitions')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (!existing) return reply.status(404).send({ error: 'Fluxo não encontrado' });

    const { data, error } = await supabase
      .from('conversation_flow_definitions')
      .update({
        ...body.data,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  app.delete('/definitions/:id', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };

    const { error } = await supabase.from('conversation_flow_definitions').delete().eq('workspace_id', workspaceId).eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(204).send();
  });

  app.post('/definitions', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = definitionSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const { data, error } = await supabase
      .from('conversation_flow_definitions')
      .insert({
        workspace_id: workspaceId,
        slug: body.data.slug,
        name: body.data.name,
        description: body.data.description ?? null,
      })
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });

    let seedGraph: Record<string, unknown> = { nodes: [{ id: 'start', type: 'start', label: 'Início' }], edges: [] };
    if (body.data.initial_graph !== undefined && body.data.initial_graph !== null) {
      const ig = body.data.initial_graph as Record<string, unknown>;
      const v = validateConversationFlowGraph(ig);
      if (!v.valid) {
        await supabase.from('conversation_flow_definitions').delete().eq('workspace_id', workspaceId).eq('id', data.id);
        return reply.status(400).send({ error: 'initial_graph inválido', validation: v });
      }
      seedGraph = ig;
    }
    const seedVal = validateConversationFlowGraph(seedGraph);
    const { data: version, error: versionError } = await supabase
      .from('conversation_flow_versions')
      .insert({
        workspace_id: workspaceId,
        definition_id: data.id,
        version_number: 1,
        status: 'draft',
        graph: seedGraph,
        validation: { valid: seedVal.valid, issues: seedVal.issues, format: seedVal.format },
        created_by: (request.user as { sub: string }).sub,
      })
      .select()
      .single();
    if (versionError) {
      await supabase.from('conversation_flow_definitions').delete().eq('workspace_id', workspaceId).eq('id', data.id);
      return reply.status(500).send({ error: versionError.message });
    }

    return reply.status(201).send({ definition: data, draft_version: version });
  });

  app.post('/definitions/:id/versions', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id: definitionId } = request.params as { id: string };

    const { data: definition, error: defErr } = await supabase
      .from('conversation_flow_definitions')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('id', definitionId)
      .maybeSingle();
    if (defErr || !definition) return reply.status(404).send({ error: 'Fluxo não encontrado' });

    const cloneSchema = z.object({ clone_from_version_id: z.string().uuid().optional() });
    const parsed = cloneSchema.safeParse(request.body || {});
    if (!parsed.success) return reply.status(400).send({ error: 'Payload inválido', details: parsed.error.flatten() });

    let graph: Record<string, unknown> = { nodes: [{ id: 'start', type: 'start', label: 'Início' }], edges: [] };
    let prevValidation: { valid: boolean; issues: string[]; format: GraphFormat } = {
      valid: true,
      issues: [],
      format: 'legacy',
    };

    if (parsed.data.clone_from_version_id) {
      const { data: src } = await supabase
        .from('conversation_flow_versions')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('id', parsed.data.clone_from_version_id)
        .eq('definition_id', definitionId)
        .maybeSingle();
      if (!src) return reply.status(404).send({ error: 'Versão origem não encontrada' });
      graph = (src.graph || {}) as Record<string, unknown>;
      const baseVal = src.validation as { valid?: boolean; issues?: string[]; format?: string } | null;
      prevValidation = {
        valid: Boolean(baseVal?.valid),
        issues: Array.isArray(baseVal?.issues) ? baseVal!.issues! : [],
        format: baseVal?.format === 'v2' ? 'v2' : 'legacy',
      };
    }

    const recomputed = validateConversationFlowGraph(graph);
    prevValidation = { valid: recomputed.valid, issues: recomputed.issues, format: recomputed.format };

    const { data: latest } = await supabase
      .from('conversation_flow_versions')
      .select('version_number')
      .eq('workspace_id', workspaceId)
      .eq('definition_id', definitionId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = Number(latest?.version_number || 0) + 1;
    const { data: draft, error } = await supabase
      .from('conversation_flow_versions')
      .insert({
        workspace_id: workspaceId,
        definition_id: definitionId,
        version_number: nextVersion,
        status: 'draft',
        graph,
        validation: prevValidation,
        created_by: (request.user as { sub: string }).sub,
      })
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send(draft);
  });

  app.get('/definitions/:id/bindings', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };

    const { data: bindings, error } = await supabase
      .from('conversation_flow_bindings')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('definition_id', id)
      .order('priority', { ascending: false });
    if (error) {
      if (error.code === '42P01' || error.message.includes('does not exist')) return reply.send([]);
      return reply.status(500).send({ error: error.message });
    }
    return reply.send(bindings || []);
  });

  app.post('/definitions/:id/bindings', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };

    const { data: definition } = await supabase
      .from('conversation_flow_definitions')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (!definition) return reply.status(404).send({ error: 'Fluxo não encontrado' });

    const body = bindingSchema.safeParse(request.body || {});
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const { data, error } = await supabase
      .from('conversation_flow_bindings')
      .insert({
        workspace_id: workspaceId,
        definition_id: id,
        workspace_channel_id: body.data.workspace_channel_id ?? null,
        trigger_type: body.data.trigger_type,
        keywords: body.data.keywords,
        priority: body.data.priority,
        is_active: body.data.is_active,
      })
      .select()
      .single();
    if (error) {
      if (error.code === '42P01' || error.message.includes('does not exist')) {
        return reply.status(503).send({ error: 'Bindings não disponíveis: aplique a migration conversation_flow_bindings.' });
      }
      return reply.status(500).send({ error: error.message });
    }
    return reply.status(201).send(data);
  });

  app.patch('/bindings/:bindingId', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { bindingId } = request.params as { bindingId: string };

    const patchSchema = bindingSchema.partial();
    const body = patchSchema.safeParse(request.body || {});
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const patchPayload = Object.fromEntries(
      Object.entries(body.data).filter(([, v]) => v !== undefined)
    ) as Record<string, unknown>;
    if (Object.keys(patchPayload).length === 0) {
      return reply.status(400).send({ error: 'Nenhum campo para atualizar' });
    }

    const { data, error } = await supabase
      .from('conversation_flow_bindings')
      .update({
        ...patchPayload,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('id', bindingId)
      .select()
      .single();
    if (error) {
      if (error.code === 'PGRST116' || error.message.includes('No rows')) return reply.status(404).send({ error: 'Binding não encontrado' });
      return reply.status(500).send({ error: error.message });
    }
    return reply.send(data);
  });

  app.get('/definitions/:id/versions', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('conversation_flow_versions')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('definition_id', id)
      .order('version_number', { ascending: false });
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data || []);
  });

  app.put('/versions/:id', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = versionSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const validation = validateConversationFlowGraph(body.data.graph);
    const { data, error } = await supabase
      .from('conversation_flow_versions')
      .update({
        graph: body.data.graph,
        validation: { valid: validation.valid, issues: validation.issues, format: validation.format },
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .eq('status', 'draft')
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  app.post('/versions/:id/publish', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };

    const { data: version, error: fetchError } = await supabase
      .from('conversation_flow_versions')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();
    if (fetchError || !version) return reply.status(404).send({ error: 'Versão não encontrada' });

    const validation = validateConversationFlowGraph(version.graph || {});
    const runtimeMode = String((await readWorkspaceSetting(workspaceId, 'flow_runtime_mode')) || 'catalog').toLowerCase();

    let publishGraph: unknown = version.graph || {};
    let compiledNote: string | null = null;

    if (validation.format === 'revive_ui') {
      publishGraph = compileFlowGraphToV2(publishGraph);
      compiledNote = 'revive_blocos compilado para DSL v2 (catalog_guided_intake) na publicação.';
    } else if (validation.format === 'legacy' || isSkeletonFlowGraph(publishGraph)) {
      const compiled = compileFlowGraphToV2(publishGraph);
      if (compiled) {
        publishGraph = compiled;
        compiledNote = 'Grafo legado/esqueleto compilado para DSL v2 na publicação.';
      }
    }

    const publishedValidation = validateConversationFlowGraph(publishGraph);
    if (publishedValidation.format === 'revive_ui') {
      return reply.status(400).send({
        error:
          'Este rascunho está só no editor em blocos (Revive). Para publicar, inclua também DSL v2 ou legado no JSON — o motor ainda não executa diretamente revive_blocos.',
        validation: publishedValidation,
      });
    }
    if (!publishedValidation.valid && publishedValidation.format !== 'v2') {
      return reply.status(400).send({ error: 'Fluxo inválido', validation: publishedValidation });
    }
    if (runtimeMode === 'flow' && publishedValidation.format !== 'v2') {
      return reply.status(400).send({
        error: 'Com flow_runtime_mode=flow, publique um fluxo DSL v2 executável.',
        validation: publishedValidation,
      });
    }

    await supabase
      .from('conversation_flow_versions')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('definition_id', version.definition_id)
      .eq('status', 'published');

    const { data, error } = await supabase
      .from('conversation_flow_versions')
      .update({
        status: 'published',
        graph: publishGraph,
        validation: {
          valid: publishedValidation.valid,
          issues: publishedValidation.issues,
          format: publishedValidation.format,
          compiled_note: compiledNote,
        },
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  app.post('/versions/:id/rollback', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };

    const { data: source, error: sourceError } = await supabase
      .from('conversation_flow_versions')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();
    if (sourceError || !source) return reply.status(404).send({ error: 'Versão não encontrada' });

    const { data: latest } = await supabase
      .from('conversation_flow_versions')
      .select('version_number')
      .eq('workspace_id', workspaceId)
      .eq('definition_id', source.definition_id)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = Number(latest?.version_number || 0) + 1;
    const { data, error } = await supabase
      .from('conversation_flow_versions')
      .insert({
        workspace_id: workspaceId,
        definition_id: source.definition_id,
        version_number: nextVersion,
        status: 'draft',
        graph: source.graph,
        validation: source.validation,
        created_by: (request.user as { sub: string }).sub,
      })
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  app.post('/simulate', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = simulateSchema.safeParse(request.body || {});
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    let version = null as Record<string, unknown> | null;
    if (body.data.version_id) {
      const { data } = await supabase
        .from('conversation_flow_versions')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('id', body.data.version_id)
        .maybeSingle();
      version = data;
    } else {
      const { data: definition } = await supabase
        .from('conversation_flow_definitions')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('slug', 'guided-intake')
        .maybeSingle();
      if (definition?.id) version = await getPublishedVersion(workspaceId, String(definition.id));
    }

    if (!version) return reply.status(404).send({ error: 'Versão para simulação não encontrada' });

    const rawGraph = version.graph ?? {};
    const validation = validateConversationFlowGraph(rawGraph);
    const inputObj =
      body.data.input && typeof body.data.input === 'object' && !Array.isArray(body.data.input)
        ? (body.data.input as Record<string, unknown>)
        : {};
    const simIn = parseSimulateInput(inputObj);

    let trace: string[] = [];
    let ended = false;
    let last_await: string | undefined;

    if (validation.format === 'v2') {
      const g = rawGraph as Record<string, unknown>;
      const entry = String(g.entry_node_id || '').trim();
      const nodes = g.nodes as Record<string, Record<string, unknown>> | undefined;
      if (entry && nodes && typeof nodes === 'object' && !Array.isArray(nodes)) {
        const walk = simulateV2Trace({ entry_node_id: entry, nodes }, simIn);
        trace = walk.trace;
        ended = walk.ended;
        last_await = walk.last_await;
      } else {
        trace = ['v2:invalid_graph'];
      }
    } else if (validation.format === 'revive_ui') {
      trace = ['revive_ui:sem_execução_direta'];
      ended = false;
      last_await = undefined;
    } else {
      const walk = simulateLegacyTrace(rawGraph as { nodes?: unknown; edges?: unknown }, simIn);
      trace = walk.trace;
      ended = walk.ended;
      last_await = walk.last_await;
    }

    const legacyNodes = (rawGraph as { nodes?: Array<Record<string, unknown>> }).nodes;
    const start =
      Array.isArray(legacyNodes) ? legacyNodes.find((n) => String(n.type || '') === 'start') || null : null;

    return reply.send({
      ok: validation.valid,
      validation: { valid: validation.valid, issues: validation.issues, format: validation.format },
      format: validation.format,
      start_node:
        validation.format === 'legacy'
          ? start
          : { id: String((rawGraph as Record<string, unknown>).entry_node_id || '') },
      input: body.data.input,
      trace,
      ended,
      last_await,
    });
  });
}
