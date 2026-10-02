/**
 * Compila grafos legado (nodes[] + edges[]) e detecta v2 executável.
 * Usado na publicação (API) e no runtime do orchestrator.
 */

export type V2FlowGraph = {
  entry_node_id: string;
  nodes: Record<string, Record<string, unknown>>;
};

const SKELETON_LEGACY_TYPES = new Set(['start', 'profile', 'sector', 'demand', 'route']);

function isV2Shape(g: Record<string, unknown>): boolean {
  return (
    typeof g.entry_node_id === 'string' &&
    g.entry_node_id.trim().length > 0 &&
    g.nodes != null &&
    typeof g.nodes === 'object' &&
    !Array.isArray(g.nodes)
  );
}

function asNodeArray(nodes: unknown): Array<Record<string, unknown>> {
  return Array.isArray(nodes) ? (nodes as Array<Record<string, unknown>>) : [];
}

function asEdges(edges: unknown): Array<Record<string, unknown>> {
  return Array.isArray(edges) ? (edges as Array<Record<string, unknown>>) : [];
}

/** Grafo v2 mínimo: delega triagem ao motor de catálogo/legado guiado. */
export function buildCatalogGuidedIntakeV2Graph(): V2FlowGraph {
  return {
    entry_node_id: 'triagem_catalogo',
    nodes: {
      triagem_catalogo: {
        type: 'catalog_guided_intake',
        label: 'Triagem guiada (catálogo)',
      },
    },
  };
}

/** Grafo v2: triagem por perfil (identificar → perfil → setor → demanda via legado). */
export function buildTriagemPorPerfilV2Graph(): V2FlowGraph {
  return {
    entry_node_id: 'triagem_por_perfil',
    nodes: {
      triagem_por_perfil: {
        type: 'catalog_triagem_por_perfil',
        label: 'Triagem por perfil',
      },
    },
  };
}

type ReviveBloco = {
  tipo?: string;
  config?: Record<string, unknown>;
  ramos?: Record<string, ReviveBloco[]>;
};

function findReviveBloco(blocos: ReviveBloco[], tipo: string): ReviveBloco | null {
  for (const b of blocos) {
    if (String(b.tipo || '') === tipo) return b;
    if (b.ramos) {
      for (const kids of Object.values(b.ramos)) {
        const hit = findReviveBloco(kids || [], tipo);
        if (hit) return hit;
      }
    }
  }
  return null;
}

function pickWelcomeFromRevive(blocos: ReviveBloco[]): string | null {
  const identify = findReviveBloco(blocos, 'identificar');
  const notFound = identify?.ramos?.['Não encontrado'] || [];
  for (const b of notFound) {
    if (String(b.tipo || '') === 'enviar-mensagem') {
      const text = String(b.config?.texto || '').trim();
      if (text) return text;
    }
  }
  return null;
}

/** Converte árvore revive_blocos (preset Triagem por perfil) para DSL v2 executável. */
export function compileReviveBlocosToV2(blocos: unknown): V2FlowGraph | null {
  if (!Array.isArray(blocos) || !blocos.length) return null;
  const list = blocos as ReviveBloco[];
  const hasIdentify = list.some((b) => String(b.tipo || '') === 'identificar') || findReviveBloco(list, 'identificar');
  if (!hasIdentify) return null;

  const welcome = pickWelcomeFromRevive(list);
  const graph = buildTriagemPorPerfilV2Graph();
  if (welcome) {
    graph.nodes.triagem_por_perfil.welcome_text = welcome;
  }
  return graph;
}

function isSkeletonLegacyGraph(nodes: Array<Record<string, unknown>>): boolean {
  if (!nodes.length) return true;
  return nodes.every((n) => SKELETON_LEGACY_TYPES.has(String(n.type || '').trim().toLowerCase()));
}

function compileLegacyToV2(graph: Record<string, unknown>): V2FlowGraph | null {
  const nodes = asNodeArray(graph.nodes);
  const edges = asEdges(graph.edges);
  if (!nodes.length) return null;

  if (isSkeletonLegacyGraph(nodes)) {
    return buildCatalogGuidedIntakeV2Graph();
  }

  const start = nodes.find((n) => String(n.type || '').trim().toLowerCase() === 'start');
  const entryId = start ? String(start.id || '').trim() : String(nodes[0]?.id || '').trim();
  if (!entryId) return null;

  const nextByFrom = new Map<string, string>();
  for (const edge of edges) {
    const from = String(edge.from || edge.source || '').trim();
    const to = String(edge.to || edge.target || '').trim();
    if (from && to && !nextByFrom.has(from)) nextByFrom.set(from, to);
  }

  const v2Nodes: Record<string, Record<string, unknown>> = {};
  for (const node of nodes) {
    const id = String(node.id || '').trim();
    if (!id) continue;
    const legacyType = String(node.type || '').trim().toLowerCase();
    const next = nextByFrom.get(id);
    const base: Record<string, unknown> = {
      ...node,
      type: legacyType === 'start' ? 'start' : legacyType,
    };
    if (next) base.next = next;
    v2Nodes[id] = base;
  }

  return { entry_node_id: entryId, nodes: v2Nodes };
}

/**
 * Normaliza qualquer grafo publicado para v2 executável quando possível.
 * Retorna null se não houver grafo utilizável.
 */
export function compileFlowGraphToV2(graph: unknown): V2FlowGraph | null {
  if (!graph || typeof graph !== 'object') return null;
  const g = graph as Record<string, unknown>;

  if (isV2Shape(g)) {
    return {
      entry_node_id: String(g.entry_node_id).trim(),
      nodes: g.nodes as Record<string, Record<string, unknown>>,
    };
  }

  if (Array.isArray(g.revive_blocos)) {
    return compileReviveBlocosToV2(g.revive_blocos) || buildCatalogGuidedIntakeV2Graph();
  }

  if (Array.isArray(g.nodes)) {
    return compileLegacyToV2(g);
  }

  return null;
}

export function graphHasUserFacingSteps(graph: V2FlowGraph): boolean {
  return Object.values(graph.nodes).some((node) => {
    const type = String(node.type || '').trim().toLowerCase();
    return (
      type === 'send_message' ||
      type === 'prompt_choice' ||
      type === 'prompt_text' ||
      type === 'catalog_guided_intake' ||
      type === 'catalog_triagem_por_perfil'
    );
  });
}

export function isSkeletonFlowGraph(graph: unknown): boolean {
  const v2 = compileFlowGraphToV2(graph);
  if (!v2) return true;
  if (graphHasUserFacingSteps(v2)) return false;
  const types = Object.values(v2.nodes).map((n) => String(n.type || '').trim().toLowerCase());
  return types.every((t) => SKELETON_LEGACY_TYPES.has(t) || t === 'start' || t === 'catalog_guided_intake');
}
