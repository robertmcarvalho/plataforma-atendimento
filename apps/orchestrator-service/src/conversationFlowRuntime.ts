/**
 * Executor MVP de fluxos publicados (DSL v2: entry_node_id + nodes map).
 * Persistência: conversation_flow_sessions. Resolução de versão: bindings ativos ou slug guided-intake.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type FlowTurnDeps = {
  sendText: (to: string, text: string) => Promise<void>;
  sendButtons: (to: string, body: string, buttons: Array<{ id: string; title: string }>) => Promise<void>;
  sendList: (
    to: string,
    body: string,
    buttonLabel: string,
    sectionTitle: string,
    rows: Array<{ id: string; title: string; description?: string }>
  ) => Promise<void>;
  extractInteractiveId: (msg: Record<string, unknown>) => string | undefined;
};

export type FlowTurnResult = 'handled' | 'skipped';

type V2Graph = { entry_node_id: string; nodes: Record<string, Record<string, unknown>> };

type FlowSessionState = {
  current_node_id: string;
  vars?: Record<string, string>;
  awaiting?: { kind: 'prompt_choice' | 'prompt_text'; node_id: string; variable?: string };
  completed?: boolean;
};

function parseV2(graph: unknown): V2Graph | null {
  if (!graph || typeof graph !== 'object') return null;
  const g = graph as Record<string, unknown>;
  const entry = typeof g.entry_node_id === 'string' ? g.entry_node_id.trim() : '';
  const nodes = g.nodes;
  if (!entry || !nodes || typeof nodes !== 'object' || Array.isArray(nodes)) return null;
  return { entry_node_id: entry, nodes: nodes as Record<string, Record<string, unknown>> };
}

function pickText(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'pt' in raw) {
    return String((raw as Record<string, unknown>).pt || '').trim();
  }
  return '';
}

async function getPublishedVersionForDefinition(
  db: SupabaseClient,
  workspaceId: string,
  definitionId: string
): Promise<{ id: string; graph: unknown } | null> {
  const { data } = await db
    .from('conversation_flow_versions')
    .select('id, graph')
    .eq('workspace_id', workspaceId)
    .eq('definition_id', definitionId)
    .eq('status', 'published')
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ? { id: String(data.id), graph: data.graph } : null;
}

async function resolvePublishedV2Flow(
  db: SupabaseClient,
  workspaceId: string
): Promise<{ versionId: string; definitionId: string; graph: V2Graph } | null> {
  const { data: binds } = await db
    .from('conversation_flow_bindings')
    .select('definition_id')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('priority', { ascending: false });

  for (const row of binds || []) {
    const defId = String((row as { definition_id?: string }).definition_id || '');
    if (!defId) continue;
    const ver = await getPublishedVersionForDefinition(db, workspaceId, defId);
    const g = ver?.graph ? parseV2(ver.graph) : null;
    if (ver && g) return { versionId: ver.id, definitionId: defId, graph: g };
  }

  const { data: def } = await db
    .from('conversation_flow_definitions')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('slug', 'guided-intake')
    .maybeSingle();
  const defId = def?.id ? String(def.id) : '';
  if (!defId) return null;
  const ver = await getPublishedVersionForDefinition(db, workspaceId, defId);
  const g = ver?.graph ? parseV2(ver.graph) : null;
  if (ver && g) return { versionId: ver.id, definitionId: defId, graph: g };
  return null;
}

async function loadOrCreateSession(
  db: SupabaseClient,
  args: {
    workspaceId: string;
    conversationId: string;
    flowVersionId: string;
    botSessionId: string;
    entryNodeId: string;
  }
): Promise<{ id: string; state: FlowSessionState }> {
  const { data: existing } = await db
    .from('conversation_flow_sessions')
    .select('id, state, flow_version_id')
    .eq('workspace_id', args.workspaceId)
    .eq('conversation_id', args.conversationId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id && String((existing as { flow_version_id?: string }).flow_version_id) === args.flowVersionId) {
    const st = ((existing as { state?: FlowSessionState }).state || {}) as FlowSessionState;
    if (!st.current_node_id) st.current_node_id = args.entryNodeId;
    return { id: String(existing.id), state: st };
  }

  const initial: FlowSessionState = {
    current_node_id: args.entryNodeId,
    vars: {},
  };
  const { data: inserted, error } = await db
    .from('conversation_flow_sessions')
    .insert({
      workspace_id: args.workspaceId,
      conversation_id: args.conversationId,
      bot_session_id: args.botSessionId,
      flow_version_id: args.flowVersionId,
      state: initial,
    })
    .select('id, state')
    .single();
  if (error) throw error;
  return { id: String(inserted!.id), state: (inserted!.state as FlowSessionState) || initial };
}

async function persistSessionState(db: SupabaseClient, sessionId: string, state: FlowSessionState) {
  await db
    .from('conversation_flow_sessions')
    .update({ state, updated_at: new Date().toISOString() })
    .eq('id', sessionId);
}

function normalizeInboundText(s: string) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function resolveChoice(
  node: Record<string, unknown>,
  msg: Record<string, unknown>,
  rawText: string,
  deps: FlowTurnDeps
): string | null {
  const id = deps.extractInteractiveId(msg);
  if (id) {
    const options = Array.isArray(node.options) ? node.options : [];
    for (const opt of options) {
      if (!opt || typeof opt !== 'object') continue;
      const o = opt as Record<string, unknown>;
      if (String(o.id || '') === id && typeof o.next === 'string') return o.next.trim();
    }
  }
  const n = Number.parseInt(String(rawText || '').trim(), 10);
  if (!Number.isNaN(n) && n >= 1) {
    const options = Array.isArray(node.options) ? node.options : [];
    const idx = n - 1;
    const opt = options[idx] as Record<string, unknown> | undefined;
    if (opt && typeof opt.next === 'string') return opt.next.trim();
  }
  return null;
}

/**
 * Processa um turno inbound no fluxo v2 publicado.
 */
export async function tryConversationFlowTurn(
  db: SupabaseClient,
  deps: FlowTurnDeps,
  input: {
    workspaceId: string;
    conversationId: string;
    contactWa: string;
    botSessionId: string;
    msg: Record<string, unknown>;
    rawText: string;
  }
): Promise<FlowTurnResult> {
  const resolved = await resolvePublishedV2Flow(db, input.workspaceId);
  if (!resolved) return 'skipped';

  const { graph, versionId, definitionId } = resolved;
  void definitionId;

  const sessionRow = await loadOrCreateSession(db, {
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    flowVersionId: versionId,
    botSessionId: input.botSessionId,
    entryNodeId: graph.entry_node_id,
  });

  let state = { ...sessionRow.state };
  if (state.completed) return 'skipped';

  const to = input.contactWa;
  const nodes = graph.nodes;
  const maxSteps = 12;
  let stepCount = 0;

  while (stepCount < maxSteps) {
    stepCount += 1;
    const nodeId = state.current_node_id;
    const node = nodes[nodeId];
    if (!node || typeof node !== 'object') {
      state = { ...state, completed: true };
      await persistSessionState(db, sessionRow.id, state);
      return 'handled';
    }

    const type = String(node.type || '');

    if (state.awaiting?.kind === 'prompt_choice' && state.awaiting.node_id === nodeId) {
      const nextId = resolveChoice(node, input.msg, input.rawText, deps);
      if (nextId && nodes[nextId]) {
        state = { ...state, awaiting: undefined, current_node_id: nextId };
        await persistSessionState(db, sessionRow.id, state);
        continue;
      }
      await persistSessionState(db, sessionRow.id, state);
      return 'handled';
    }

    if (state.awaiting?.kind === 'prompt_text' && state.awaiting.node_id === nodeId) {
      const v = String(input.rawText || '').trim();
      if (v) {
        const varName = String(state.awaiting.variable || node.variable || 'reply');
        const vars = { ...(state.vars || {}) };
        vars[varName] = v;
        const nextId = typeof node.next === 'string' ? node.next.trim() : '';
        if (nextId && nodes[nextId]) {
          state = { ...state, awaiting: undefined, vars, current_node_id: nextId };
          await persistSessionState(db, sessionRow.id, state);
          continue;
        }
        state = { ...state, awaiting: undefined, vars };
        await persistSessionState(db, sessionRow.id, state);
        return 'handled';
      }
      await persistSessionState(db, sessionRow.id, state);
      return 'handled';
    }

    switch (type) {
      case 'send_message': {
        const text = pickText(node.text) || pickText(node.body) || pickText(node.message) || '';
        if (text) await deps.sendText(to, text);
        const nextId = typeof node.next === 'string' ? node.next.trim() : '';
        if (!nextId || !nodes[nextId]) {
          state = { ...state, completed: true };
          await persistSessionState(db, sessionRow.id, state);
          return 'handled';
        }
        state = { ...state, current_node_id: nextId };
        await persistSessionState(db, sessionRow.id, state);
        continue;
      }
      case 'prompt_choice': {
        const options = Array.isArray(node.options) ? node.options : [];
        const body =
          pickText(node.prompt) || pickText(node.body) || pickText(node.message) || 'Escolha uma opção:';
        const rows = options
          .map((opt) => {
            if (!opt || typeof opt !== 'object') return null;
            const o = opt as Record<string, unknown>;
            const id = String(o.id || '').trim();
            const title = pickText(o.label) || pickText(o.title) || id;
            if (!id || !title) return null;
            return { id, title };
          })
          .filter(Boolean) as Array<{ id: string; title: string }>;

        if (!rows.length) {
          state = { ...state, completed: true };
          await persistSessionState(db, sessionRow.id, state);
          return 'handled';
        }

        state = { ...state, awaiting: { kind: 'prompt_choice', node_id: nodeId } };
        await persistSessionState(db, sessionRow.id, state);

        if (rows.length <= 3) {
          await deps.sendButtons(
            to,
            body,
            rows.map((r) => ({ id: r.id, title: r.title.slice(0, 20) }))
          );
        } else {
          await deps.sendList(to, body, 'Ver opções', 'Opções', rows);
        }
        return 'handled';
      }
      case 'prompt_text': {
        const body =
          pickText(node.prompt) || pickText(node.body) || pickText(node.message) || 'Envie sua resposta:';
        const variable = String(node.variable || 'reply');
        state = { ...state, awaiting: { kind: 'prompt_text', node_id: nodeId, variable } };
        await persistSessionState(db, sessionRow.id, state);
        await deps.sendText(to, body);
        return 'handled';
      }
      case 'switch_text':
      case 'switch_on_text': {
        const sample = normalizeInboundText(input.rawText);
        const rules: unknown[] = Array.isArray(node.rules) ? node.rules : [];
        let hit: string | null = null;
        for (const rule of rules) {
          if (!rule || typeof rule !== 'object') continue;
          const r = rule as Record<string, unknown>;
          const nx = r.next;
          if (typeof nx !== 'string' || !nx.trim()) continue;
          const kind = String(r.kind || r.op || 'contains');
          const pat = normalizeInboundText(String(r.pattern || r.value || ''));
          if (!pat) continue;
          if (kind === 'equals' && sample === pat) {
            hit = nx.trim();
            break;
          }
          if ((kind === 'contains' || kind === 'includes') && sample.includes(pat)) {
            hit = nx.trim();
            break;
          }
        }
        const nextId = hit || (typeof node.default_next === 'string' ? node.default_next.trim() : '');
        if (!nextId || !nodes[nextId]) {
          state = { ...state, completed: true };
          await persistSessionState(db, sessionRow.id, state);
          return 'handled';
        }
        state = { ...state, current_node_id: nextId };
        await persistSessionState(db, sessionRow.id, state);
        continue;
      }
      case 'switch_variable':
      case 'switch_on_variable': {
        const variable = String(node.variable || '');
        const val = variable ? state.vars?.[variable] : undefined;
        const cases: unknown[] = Array.isArray(node.cases) ? node.cases : [];
        let hit: string | null = null;
        for (const raw of cases) {
          if (!raw || typeof raw !== 'object') continue;
          const c = raw as Record<string, unknown>;
          const m = c.match;
          const nx = c.next;
          if (typeof nx !== 'string' || !nx.trim()) continue;
          if (Array.isArray(m)) {
            if (m.map(String).includes(String(val ?? ''))) {
              hit = nx.trim();
              break;
            }
          } else if (m !== undefined && String(m) === String(val ?? '')) {
            hit = nx.trim();
            break;
          }
        }
        const nextId = hit || (typeof node.default_next === 'string' ? node.default_next.trim() : '');
        if (!nextId || !nodes[nextId]) {
          state = { ...state, completed: true };
          await persistSessionState(db, sessionRow.id, state);
          return 'handled';
        }
        state = { ...state, current_node_id: nextId };
        await persistSessionState(db, sessionRow.id, state);
        continue;
      }
      case 'gate_channel':
      case 'start':
      case 'assign_sector':
      case 'assign_queue':
      case 'apply_tag': {
        const nextId = typeof node.next === 'string' ? node.next.trim() : '';
        if (!nextId || !nodes[nextId]) {
          state = { ...state, completed: true };
          await persistSessionState(db, sessionRow.id, state);
          return 'handled';
        }
        state = { ...state, current_node_id: nextId };
        await persistSessionState(db, sessionRow.id, state);
        continue;
      }
      default: {
        const nextId = typeof node.next === 'string' ? node.next.trim() : '';
        if (!nextId || !nodes[nextId]) {
          state = { ...state, completed: true };
          await persistSessionState(db, sessionRow.id, state);
          return 'handled';
        }
        state = { ...state, current_node_id: nextId };
        await persistSessionState(db, sessionRow.id, state);
        continue;
      }
    }
  }

  await persistSessionState(db, sessionRow.id, state);
  return 'handled';
}
