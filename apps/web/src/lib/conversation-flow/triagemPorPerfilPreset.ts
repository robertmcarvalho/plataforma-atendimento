/** Helpers para mapear setores configurados no webhook para o preset Revive de Triagem por perfil. */

/** IDs de setor por “papel” (UUIDs do workspace ou placeholders do catálogo mock). */
export type SetoresPorPerfilPools = {
  entregador: string[];
  farmacia: string[];
  lider: string[];
};

/** Regra: primeira expressão que casar no nome normalizado decide o pool (ordem importa). */
export type TriagemSetorRule = {
  pool: keyof SetoresPorPerfilPools;
  patterns: RegExp[];
};

/**
 * Regras padrão (PT/EN) — ajuste por workspace no futuro (ex.: `workspace_settings`).
 * Ordem: RH/líder → comercial/farmácia → operação/suporte/financeiro operacional.
 */
export const DEFAULT_TRIAGEM_SETOR_RULES: TriagemSetorRule[] = [
  {
    pool: 'lider',
    patterns: [
      /\b(rh|pessoal|people|human|gente)\b/i,
      /(l[ií]der|lideran|leadership|coordena)/i,
      /(recursos humanos)/i,
    ],
  },
  {
    pool: 'farmacia',
    patterns: [
      /(farm[aá]c|drogar)/i,
      /(comercial|venda|sales)/i,
      /(fatur|nota fiscal|\bnf\b|n\.?\s*f\.?|cobran)/i,
      /(receita|contrato)/i,
    ],
  },
  {
    pool: 'entregador',
    patterns: [
      /(opera(ção|cao)|log[ií]st|entrega|rota|motorista|driver|courier)/i,
      /(suporte|help|atendimento|ticket|plataforma)/i,
      /(finance|pagamento|repasse)/i,
    ],
  },
];

function normalizeSectorName(name: string): string {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Mapeia setores do tenant para os três pools do preset usando **nome** (regex por regra).
 * Setores sem match entram em **entregador → farmácia → líder** por round-robin.
 */
export function mapSectorsToTriagemPoolsByName(
  sectors: { id: string; name: string }[],
  rules: TriagemSetorRule[] = DEFAULT_TRIAGEM_SETOR_RULES
): SetoresPorPerfilPools {
  const pools: SetoresPorPerfilPools = { entregador: [], farmacia: [], lider: [] };
  const unmatched: { id: string; name: string }[] = [];

  for (const s of sectors) {
    if (!s.id) continue;
    const n = normalizeSectorName(s.name);
    let hit: keyof SetoresPorPerfilPools | null = null;
    for (const rule of rules) {
      if (rule.patterns.some((re) => re.test(n))) {
        hit = rule.pool;
        break;
      }
    }
    if (hit) pools[hit].push(s.id);
    else unmatched.push(s);
  }

  const order: (keyof SetoresPorPerfilPools)[] = ['entregador', 'farmacia', 'lider'];
  unmatched.forEach((u, i) => {
    pools[order[i % 3]!].push(u.id);
  });

  const firstId = sectors.find((s) => s.id)?.id || '';
  return ensureEachPoolNonEmpty(pools, firstId);
}

function ensureEachPoolNonEmpty(pools: SetoresPorPerfilPools, fallbackId: string): SetoresPorPerfilPools {
  if (!fallbackId) return pools;
  const out: SetoresPorPerfilPools = { ...pools };
  for (const k of ['entregador', 'farmacia', 'lider'] as const) {
    if (out[k].length === 0) out[k] = [fallbackId];
  }
  return out;
}

/**
 * Entrada única para o wizard: sem setores → mock; com setores → regras por nome + fallback.
 */
export function resolveSetoresPorPerfilForPreset(sectors: { id: string; name: string }[]): SetoresPorPerfilPools {
  const list = sectors.filter((s) => s.id);
  if (!list.length) return { entregador: [], farmacia: [], lider: [] };
  return mapSectorsToTriagemPoolsByName(list);
}

/**
 * Reparte setores ativos do workspace em três listas (apenas por posição — sem nomes).
 * Preferir `resolveSetoresPorPerfilForPreset` quando tiver `name`.
 */
export function partitionSectorIdsForPreset(sectors: { id: string }[]): SetoresPorPerfilPools {
  const ids = sectors.map((s) => s.id).filter(Boolean);
  if (!ids.length) return { entregador: [], farmacia: [], lider: [] };
  const n = ids.length;
  const a = Math.max(1, Math.floor(n / 3));
  const b = Math.max(1, Math.floor((n - a) / 2));
  return {
    entregador: ids.slice(0, a),
    farmacia: ids.slice(a, a + b),
    lider: ids.slice(a + b),
  };
}

