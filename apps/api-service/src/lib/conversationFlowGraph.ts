/**
 * Validação de grafo legado (nodes[] + edges[]), DSL v2 (entry_node_id + nodes Record),
 * e editor em blocos (revive_blocos[] — Revive AutomacaoNova).
 * Ver docs/FLOW_EDITOR_AND_POLICIES_PLAN.md.
 */

export type GraphValidation = { valid: boolean; issues: string[] };
export type GraphFormat = 'legacy' | 'v2' | 'revive_ui';

/** Tipos de bloco do editor em árvore (fluxo conversacional / fluxo.ts). */
const REVIVE_BLOCO_TIPOS = new Set<string>([
  'identificar',
  'escolha-perfil',
  'selecionar-setor',
  'selecionar-demanda',
  'pergunta',
  'menu-farmacias',
  'enviar-mensagem',
  'script-bot',
  'ia-resposta',
  'criar-precadastro',
  'aplicar-tag',
  'notificar-atendente',
  'atribuir-fila',
  'sla-etapa',
  'sla-fila',
  'escalar-gestor',
  'csat',
]);

function isV2Shape(g: Record<string, unknown>): boolean {
  return (
    typeof g.entry_node_id === 'string' &&
    g.entry_node_id.trim().length > 0 &&
    g.nodes != null &&
    typeof g.nodes === 'object' &&
    !Array.isArray(g.nodes)
  );
}

export function detectGraphFormat(graph: unknown): GraphFormat {
  if (!graph || typeof graph !== 'object') return 'legacy';
  const g = graph as Record<string, unknown>;
  if (isV2Shape(g)) return 'v2';
  if (Array.isArray(g.revive_blocos)) return 'revive_ui';
  return 'legacy';
}

function validateReviveFlowGraph(graph: Record<string, unknown>): GraphValidation {
  const list = graph.revive_blocos;
  if (!Array.isArray(list)) {
    return { valid: false, issues: ['Campo revive_blocos ausente ou inválido.'] };
  }
  const issues: string[] = [];
  const visit = (node: unknown, path: string) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      issues.push(`${path}: cada bloco deve ser um objeto.`);
      return;
    }
    const b = node as Record<string, unknown>;
    if (typeof b.id !== 'string' || !b.id.trim()) issues.push(`${path}: id obrigatório (string).`);
    const tipo = typeof b.tipo === 'string' ? b.tipo : '';
    if (!tipo || !REVIVE_BLOCO_TIPOS.has(tipo)) {
      issues.push(`${path}: tipo de bloco desconhecido: ${tipo || '(vazio)'}`);
    }
    if (b.config != null && typeof b.config !== 'object') issues.push(`${path}: config deve ser objeto.`);
    if (b.ramos != null) {
      if (typeof b.ramos !== 'object' || Array.isArray(b.ramos)) {
        issues.push(`${path}: ramos deve ser um mapa de listas.`);
        return;
      }
      for (const [ramo, children] of Object.entries(b.ramos as Record<string, unknown>)) {
        if (!Array.isArray(children)) {
          issues.push(`${path}.ramos[${ramo}]: filhos devem ser lista.`);
          continue;
        }
        children.forEach((child, i) => visit(child, `${path}.ramos[${JSON.stringify(ramo)}][${i}]`));
      }
    }
  };
  list.forEach((item, i) => visit(item, `revive_blocos[${i}]`));
  const seqIssues = validateReviveSiblingPrecadastroChains(list);
  issues.push(...seqIssues);
  return { valid: issues.length === 0, issues };
}

/**
 * Na mesma lista linear de irmãos, dois `criar-precadastro` com `config.tipo` diferente
 * sem `escolha-perfil` / `identificar` entre eles viola o plano §0.4.
 */
function validateReviveSiblingPrecadastroChains(reviveBlocas: unknown[]): string[] {
  const issues: string[] = [];
  const walkList = (siblings: unknown[], path: string) => {
    let lastPrecadTipo: string | null = null;
    siblings.forEach((node, i) => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      const b = node as Record<string, unknown>;
      const tipo = typeof b.tipo === 'string' ? b.tipo : '';
      const cfg = b.config && typeof b.config === 'object' && !Array.isArray(b.config) ? (b.config as Record<string, unknown>) : {};
      if (tipo === 'criar-precadastro') {
        const t = String(cfg.tipo || '').trim();
        if (lastPrecadTipo && t && lastPrecadTipo !== t) {
          issues.push(
            `${path}[${i}]: sequência com criar-precadastro "${lastPrecadTipo}" seguido de "${t}" — separe por escolha-perfil ou identificar (planos §0.4).`
          );
        }
        if (t) lastPrecadTipo = t;
      } else if (tipo === 'escolha-perfil' || tipo === 'identificar') {
        lastPrecadTipo = null;
      }
      if (b.ramos != null && typeof b.ramos === 'object' && !Array.isArray(b.ramos)) {
        for (const [ramo, children] of Object.entries(b.ramos as Record<string, unknown>)) {
          if (Array.isArray(children)) walkList(children, `${path}[${i}].ramos[${JSON.stringify(ramo)}]`);
        }
      }
    });
  };
  walkList(reviveBlocas, 'revive_blocos');
  return issues;
}

function asNodeArray(nodes: unknown): Array<Record<string, unknown>> {
  return Array.isArray(nodes) ? (nodes as Array<Record<string, unknown>>) : [];
}

function asEdges(edges: unknown): Array<Record<string, unknown>> {
  return Array.isArray(edges) ? (edges as Array<Record<string, unknown>>) : [];
}

export function validateLegacyFlowGraph(graph: { nodes?: unknown; edges?: unknown }): GraphValidation {
  const issues: string[] = [];
  const nodes = asNodeArray(graph.nodes);
  const edges = asEdges(graph.edges);
  if (!nodes.length) issues.push('Fluxo sem nós.');
  const nodeIds = new Set(nodes.map((n) => String(n.id || '')).filter(Boolean));
  for (const edge of edges) {
    const from = String(edge.from || edge.source || '');
    const to = String(edge.to || edge.target || '');
    if (from && !nodeIds.has(from)) issues.push(`Aresta com origem inválida: ${from}`);
    if (to && !nodeIds.has(to)) issues.push(`Aresta com destino inválido: ${to}`);
  }
  const starts = nodes.filter((n) => String(n.type || '') === 'start');
  if (starts.length !== 1) issues.push('Fluxo legado deve ter exatamente um nó inicial (type=start).');

  const startId = starts[0] ? String(starts[0].id || '') : '';
  if (startId && hasDirectedCycle(nodeIds, edges)) {
    issues.push('Ciclo detectado no grafo; remova loops ou use ramos condicionais.');
  }

  if (startId) {
    const reachable = reachableFromStart(startId, nodeIds, edges);
    for (const id of nodeIds) {
      if (!reachable.has(id)) issues.push(`Nó inalcançável a partir do início: ${id}`);
    }
  }

  return { valid: issues.length === 0, issues };
}

function hasDirectedCycle(nodeIds: Set<string>, edges: Array<Record<string, unknown>>): boolean {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const from = String(e.from || e.source || '');
    const to = String(e.to || e.target || '');
    if (!from || !to || !nodeIds.has(from) || !nodeIds.has(to)) continue;
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push(to);
  }
  const color = new Map<string, number>();
  for (const id of nodeIds) color.set(id, 0);

  const dfs = (u: string): boolean => {
    const c = color.get(u) ?? 0;
    if (c === 1) return true;
    if (c === 2) return false;
    color.set(u, 1);
    for (const v of adj.get(u) || []) {
      if (dfs(v)) return true;
    }
    color.set(u, 2);
    return false;
  };

  for (const id of nodeIds) {
    if (dfs(id)) return true;
  }
  return false;
}

function reachableFromStart(
  startId: string,
  nodeIds: Set<string>,
  edges: Array<Record<string, unknown>>
): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const from = String(e.from || e.source || '');
    const to = String(e.to || e.target || '');
    if (!from || !to) continue;
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push(to);
  }
  const seen = new Set<string>();
  const stack = [startId];
  while (stack.length) {
    const u = stack.pop()!;
    if (!nodeIds.has(u) || seen.has(u)) continue;
    seen.add(u);
    for (const v of adj.get(u) || []) stack.push(v);
  }
  return seen;
}

/** Referências explícitas de transição para validação DAG v2. */
export function collectOutgoingRefsV2(node: Record<string, unknown>): string[] {
  const type = String(node.type || '');
  const out: string[] = [];
  const one = (x: unknown) => {
    if (typeof x === 'string' && x.trim()) out.push(x.trim());
  };

  switch (type) {
    case 'send_message':
    case 'prompt_text':
    case 'assign_sector':
    case 'assign_queue':
    case 'apply_tag':
    case 'gate_channel':
    case 'start':
    case 'profile':
    case 'sector':
    case 'demand':
    case 'route':
      one(node.next);
      break;
    case 'prompt_choice':
      one(node.default_next);
      for (const opt of Array.isArray(node.options) ? node.options : []) {
        if (opt && typeof opt === 'object' && 'next' in opt) one((opt as Record<string, unknown>).next);
      }
      break;
    case 'switch_variable':
    case 'switch_on_variable':
      one(node.default_next);
      for (const c of Array.isArray(node.cases) ? node.cases : []) {
        if (c && typeof c === 'object' && 'next' in c) one((c as Record<string, unknown>).next);
      }
      break;
    case 'switch_text':
    case 'switch_on_text':
      one(node.default_next);
      for (const rule of Array.isArray(node.rules) ? node.rules : []) {
        if (rule && typeof rule === 'object' && 'next' in rule) one((rule as Record<string, unknown>).next);
      }
      break;
    case 'identify_contact':
      one(node.not_found_next);
      for (const b of Array.isArray(node.branches) ? node.branches : []) {
        if (b && typeof b === 'object' && 'next' in b) one((b as Record<string, unknown>).next);
      }
      break;
    default:
      one(node.next);
      one(node.default_next);
      one(node.not_found_next);
      break;
  }
  return [...new Set(out)];
}

export function validateV2FlowGraph(graph: { entry_node_id?: unknown; nodes?: unknown }): GraphValidation {
  const issues: string[] = [];
  const entry = typeof graph.entry_node_id === 'string' ? graph.entry_node_id.trim() : '';
  const rawNodes = graph.nodes;
  if (!entry) issues.push('DSL v2: entry_node_id é obrigatório.');
  if (!rawNodes || typeof rawNodes !== 'object' || Array.isArray(rawNodes)) {
    issues.push('DSL v2: nodes deve ser um objeto (mapa id → nó).');
    return { valid: false, issues };
  }
  const nodes = rawNodes as Record<string, Record<string, unknown>>;
  const ids = new Set(Object.keys(nodes).filter(Boolean));
  if (!ids.size) issues.push('DSL v2: nenhum nó definido.');
  if (entry && !ids.has(entry)) issues.push(`DSL v2: entry_node_id "${entry}" não existe em nodes.`);

  for (const [id, node] of Object.entries(nodes)) {
    if (!node || typeof node !== 'object') {
      issues.push(`Nó "${id}" inválido.`);
      continue;
    }
    if (!String(node.type || '').trim()) issues.push(`Nó "${id}" sem type.`);
    for (const ref of collectOutgoingRefsV2(node)) {
      if (!ids.has(ref)) issues.push(`Transição inválida em "${id}": próximo nó "${ref}" não existe.`);
    }
  }

  if (entry && ids.size && !issues.some((i) => i.includes('Ciclo'))) {
    if (hasCycleV2(entry, nodes, ids)) issues.push('Ciclo detectado no fluxo v2.');
  }

  return { valid: issues.length === 0, issues };
}

function hasCycleV2(entry: string, nodes: Record<string, Record<string, unknown>>, ids: Set<string>): boolean {
  const color = new Map<string, number>();
  for (const id of ids) color.set(id, 0);

  const dfs = (u: string): boolean => {
    const c = color.get(u) ?? 0;
    if (c === 1) return true;
    if (c === 2) return false;
    color.set(u, 1);
    for (const v of collectOutgoingRefsV2(nodes[u] || {})) {
      if (ids.has(v) && dfs(v)) return true;
    }
    color.set(u, 2);
    return false;
  };

  return dfs(entry);
}

export function validateConversationFlowGraph(graph: unknown): GraphValidation & { format: GraphFormat } {
  if (!graph || typeof graph !== 'object') {
    return { valid: false, issues: ['Graph inválido ou vazio.'], format: 'legacy' };
  }
  const format = detectGraphFormat(graph);
  const g = graph as Record<string, unknown>;
  if (format === 'v2') {
    const v = validateV2FlowGraph({ entry_node_id: g.entry_node_id, nodes: g.nodes });
    return { ...v, format };
  }
  if (format === 'revive_ui') {
    const v = validateReviveFlowGraph(g);
    return { ...v, format };
  }
  const v = validateLegacyFlowGraph({ nodes: g.nodes, edges: g.edges });
  return { ...v, format };
}

export type SimulateInputV2 = {
  choice_by_node?: Record<string, string>;
  variable_values?: Record<string, string>;
  text_sample?: string;
  identify_branch_key?: string;
};

/**
 * Percorre o grafo legado seguindo a primeira aresta saindo de cada nó (preview determinístico).
 */
export function simulateLegacyTrace(
  graph: { nodes?: unknown; edges?: unknown },
  _input: SimulateInputV2,
  maxSteps = 24
): { trace: string[]; ended: boolean; last_await?: string } {
  void _input;
  const nodes = asNodeArray(graph.nodes);
  const edges = asEdges(graph.edges);
  const start = nodes.find((n) => String(n.type || '') === 'start');
  const startId = start ? String(start.id || '') : '';
  const trace: string[] = [];
  if (!startId) return { trace: ['legacy:no_start'], ended: false };

  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const from = String(e.from || e.source || '');
    const to = String(e.to || e.target || '');
    if (!from || !to) continue;
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push(to);
  }

  let cur: string | null = startId;
  const seen = new Set<string>();
  for (let i = 0; i < maxSteps && cur; i++) {
    if (seen.has(cur)) {
      trace.push(`cycle:${cur}`);
      return { trace, ended: false };
    }
    seen.add(cur);
    trace.push(cur);
    const outs: string[] = [...(adj.get(cur) ?? [])];
    if (!outs.length) return { trace, ended: true };
    cur = outs[0] ?? null;
  }
  return { trace, ended: false, last_await: cur || undefined };
}

/**
 * Percorre o fluxo v2 de forma determinística (primeira opção / default) para preview.
 */
export function simulateV2Trace(
  graph: { entry_node_id: string; nodes: Record<string, Record<string, unknown>> },
  input: SimulateInputV2,
  maxSteps = 24
): { trace: string[]; ended: boolean; last_await?: string } {
  const trace: string[] = [];
  let current: string | null = graph.entry_node_id.trim();
  const nodes = graph.nodes;

  const norm = (s: string) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

  for (let step = 0; step < maxSteps && current; step++) {
    const stepNodeId: string = current;
    trace.push(stepNodeId);
    const node: Record<string, unknown> | undefined = nodes[stepNodeId];
    if (!node || typeof node !== 'object') {
      trace.push('error:missing_node');
      return { trace, ended: false };
    }

    const type = String(node.type || '');
    let next: string | null = null;

    switch (type) {
      case 'send_message':
      case 'prompt_text':
      case 'assign_sector':
      case 'assign_queue':
      case 'apply_tag':
      case 'gate_channel':
      case 'start':
      case 'profile':
      case 'sector':
      case 'demand':
      case 'route':
        next = typeof node.next === 'string' ? node.next.trim() || null : null;
        break;
      case 'prompt_choice': {
        const pick = input.choice_by_node?.[stepNodeId];
        const options: unknown[] = Array.isArray(node.options) ? node.options : [];
        let chosen: Record<string, unknown> | null = null;
        if (pick) {
          chosen =
            (options.find((o: unknown) => o && typeof o === 'object' && String((o as Record<string, unknown>).id || '') === pick) as Record<
              string,
              unknown
            > | null) || null;
        }
        if (!chosen && options[0] && typeof options[0] === 'object') chosen = options[0] as Record<string, unknown>;
        const fromOpt: string = chosen && typeof chosen.next === 'string' ? chosen.next.trim() : '';
        next = fromOpt || (typeof node.default_next === 'string' ? node.default_next.trim() || null : null);
        if (!next) return { trace, ended: false, last_await: `prompt_choice:${stepNodeId}` };
        break;
      }
      case 'switch_variable':
      case 'switch_on_variable': {
        const variable = String(node.variable || '');
        const val = variable ? input.variable_values?.[variable] : undefined;
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
        next = hit || (typeof node.default_next === 'string' ? node.default_next.trim() || null : null);
        break;
      }
      case 'switch_text':
      case 'switch_on_text': {
        const sample = norm(input.text_sample || '');
        const rules: unknown[] = Array.isArray(node.rules) ? node.rules : [];
        let hit: string | null = null;
        for (const rule of rules) {
          if (!rule || typeof rule !== 'object') continue;
          const r = rule as Record<string, unknown>;
          const nx = r.next;
          if (typeof nx !== 'string' || !nx.trim()) continue;
          const kind = String(r.kind || r.op || 'contains');
          const pat = norm(String(r.pattern || r.value || ''));
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
        next = hit || (typeof node.default_next === 'string' ? node.default_next.trim() || null : null);
        break;
      }
      case 'identify_contact': {
        const key = input.identify_branch_key;
        const branches: unknown[] = Array.isArray(node.branches) ? node.branches : [];
        let hit: string | null = null;
        if (key) {
          const b = branches.find(
            (x: unknown) => x && typeof x === 'object' && String((x as Record<string, unknown>).key || '') === key
          ) as Record<string, unknown> | undefined;
          if (b && typeof b.next === 'string') hit = b.next.trim() || null;
        }
        if (!hit && branches[0] && typeof branches[0] === 'object' && typeof (branches[0] as Record<string, unknown>).next === 'string') {
          hit = String((branches[0] as Record<string, unknown>).next).trim() || null;
        }
        next = hit || (typeof node.not_found_next === 'string' ? node.not_found_next.trim() || null : null);
        break;
      }
      default: {
        const fallback: string = typeof node.next === 'string' ? node.next.trim() : '';
        next = fallback || null;
      }
    }

    if (!next || !nodes[next]) {
      trace.push(next ? `end:${next}` : 'end');
      return { trace, ended: true };
    }
    current = next;
  }

  return { trace, ended: false, last_await: current || undefined };
}
