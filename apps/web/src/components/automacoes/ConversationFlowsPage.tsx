'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bot,
  Copy,
  History,
  MoreHorizontal,
  Pencil,
  Play,
  RefreshCcw,
  Search,
  Tag,
  Trash2,
} from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';
import { BlocoCard } from '@/components/conversation-flow/BlocoCard';
import { PaletaBlocos } from '@/components/conversation-flow/PaletaBlocos';
import {
  addBlocoToBranch,
  countBlocos,
  labelOf,
  novoBloco,
  removeBloco,
  toggleCollapse,
  updateBlocoConfig,
  type Bloco,
} from '@/lib/conversation-flow/fluxo';
import { useAuth } from '@/store/auth';

type FlowDefinition = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  is_active: boolean;
};

type FlowVersion = {
  id: string;
  version_number: number;
  status: string;
  published_at?: string | null;
  graph?: Record<string, unknown>;
  validation?: { valid?: boolean; issues?: string[]; format?: string };
};

function revivePreviewLines(blocos: Bloco[], limit = 10): string[] {
  const out: string[] = [];
  const walk = (list: Bloco[], depth: number) => {
    for (const b of list) {
      if (out.length >= limit) return;
      out.push(`${'·'.repeat(Math.min(depth, 4))}${b.tipo} — ${labelOf(b.tipo)}`);
      if (b.ramos) {
        for (const [rama, kids] of Object.entries(b.ramos)) {
          if (out.length >= limit) return;
          out.push(`${'·'.repeat(Math.min(depth + 1, 5))}[${rama}]`);
          walk(kids, depth + 2);
        }
      }
    }
  };
  walk(blocos, 0);
  return out;
}

function summarizeGraph(graph: Record<string, unknown> | undefined): {
  format: string;
  nodeCount: number;
  previewLines: string[];
} {
  if (!graph) return { format: '—', nodeCount: 0, previewLines: [] };
  const g = graph as Record<string, unknown>;
  if (
    typeof g.entry_node_id === 'string' &&
    String(g.entry_node_id).trim() &&
    g.nodes &&
    typeof g.nodes === 'object' &&
    !Array.isArray(g.nodes)
  ) {
    const nodes = g.nodes as Record<string, Record<string, unknown>>;
    const ids = Object.keys(nodes);
    const previewLines = ids.slice(0, 10).map((id) => {
      const t = String(nodes[id]?.type || '?');
      return `${id} · ${t}`;
    });
    return { format: 'DSL v2', nodeCount: ids.length, previewLines };
  }
  if (Array.isArray(g.revive_blocos)) {
    const blocos = g.revive_blocos as Bloco[];
    return {
      format: 'Editor blocos (Revive)',
      nodeCount: countBlocos(blocos),
      previewLines: revivePreviewLines(blocos),
    };
  }
  const arr = Array.isArray(g.nodes) ? (g.nodes as Array<{ id?: string; type?: string }>) : [];
  const previewLines = arr.slice(0, 10).map((n) => `${String(n.id || '?')} · ${String(n.type || '?')}`);
  return { format: 'Legado', nodeCount: arr.length, previewLines };
}

export default function ConversationFlowsPage() {
  const role = String(useAuth((s) => s.user?.role || '')).toLowerCase();
  const isAdmin = role === 'admin';
  const canEditFlows = role === 'admin' || role === 'supervisor';
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [graphDraft, setGraphDraft] = useState<Record<string, unknown>>({
    nodes: [],
    edges: [],
  });
  const [jsonString, setJsonString] = useState('{}');
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [editorTab, setEditorTab] = useState<'blocos' | 'json'>('blocos');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const loadedDraftIdRef = useRef<string | null>(null);

  const defsQuery = useQuery({
    queryKey: ['conversation-flow-definitions'],
    queryFn: async () => (await api.get('/api/conversation-flows/definitions')).data as FlowDefinition[],
  });

  const versionsQuery = useQuery({
    queryKey: ['conversation-flow-versions', selectedId],
    enabled: Boolean(selectedId),
    queryFn: async () =>
      (await api.get(`/api/conversation-flows/definitions/${selectedId}/versions`)).data as FlowVersion[],
  });

  const runtimeModeQuery = useQuery({
    queryKey: ['conversation-flow-runtime-mode'],
    queryFn: async () => (await api.get('/api/conversation-flows/runtime-mode')).data as { mode: string },
  });

  const selectedDefinition = useMemo(
    () => (defsQuery.data || []).find((d) => d.id === selectedId) || null,
    [defsQuery.data, selectedId]
  );

  const draftVersion = useMemo(
    () => (versionsQuery.data || []).find((v) => v.status === 'draft') || null,
    [versionsQuery.data]
  );

  const publishedVersion = useMemo(
    () => (versionsQuery.data || []).find((v) => v.status === 'published') || null,
    [versionsQuery.data]
  );

  const filteredDefs = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = defsQuery.data || [];
    if (!q) return list;
    return list.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.slug.toLowerCase().includes(q) ||
        String(d.description || '')
          .toLowerCase()
          .includes(q)
    );
  }, [defsQuery.data, query]);

  const draftGraphPreview = useMemo(
    () => summarizeGraph(draftVersion?.graph),
    [draftVersion?.graph]
  );

  useEffect(() => {
    if (!draftVersion?.id) {
      loadedDraftIdRef.current = null;
      return;
    }
    if (loadedDraftIdRef.current === draftVersion.id) return;
    loadedDraftIdRef.current = draftVersion.id;
    const g = (draftVersion.graph ?? { nodes: [], edges: [] }) as Record<string, unknown>;
    setGraphDraft({ ...g });
    try {
      setJsonString(JSON.stringify(g, null, 2));
    } catch {
      setJsonString('{}');
    }
  }, [draftVersion?.id, draftVersion?.graph]);

  const reviveBlocos = Array.isArray(graphDraft.revive_blocos)
    ? (graphDraft.revive_blocos as Bloco[])
    : [];

  const setReviveBlocos = (next: Bloco[]) => {
    setGraphDraft((prev) => ({ ...prev, revive_blocos: next }));
  };

  const createDraftVersion = async (cloneFromId?: string) => {
    if (!selectedId) return;
    setMessage(null);
    try {
      await api.post(`/api/conversation-flows/definitions/${selectedId}/versions`, {
        clone_from_version_id: cloneFromId,
      });
      loadedDraftIdRef.current = null;
      setMessage('Novo rascunho criado.');
      await versionsQuery.refetch();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Falha ao criar rascunho');
    }
  };

  const publishDraft = async (versionId: string) => {
    setMessage(null);
    try {
      await api.post(`/api/conversation-flows/versions/${versionId}/publish`);
      setMessage('Versão publicada.');
      await versionsQuery.refetch();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Falha ao publicar');
    }
  };

  const saveDraft = async () => {
    if (!selectedId) return;
    const draft = (versionsQuery.data || []).find((v) => v.status === 'draft');
    if (!draft) {
      setMessage('Nenhum rascunho disponível para salvar.');
      return;
    }
    setMessage(null);
    try {
      const graph =
        editorTab === 'json'
          ? (JSON.parse(jsonString) as Record<string, unknown>)
          : ({ ...graphDraft } as Record<string, unknown>);
      await api.put(`/api/conversation-flows/versions/${draft.id}`, { graph });
      setMessage('Rascunho salvo.');
      await versionsQuery.refetch();
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : editorTab === 'json' ? 'JSON inválido ou falha ao salvar' : 'Falha ao salvar'
      );
    }
  };

  const simulate = async () => {
    setMessage(null);
    try {
      const draft = (versionsQuery.data || []).find((v) => v.status === 'draft');
      const res = await api.post('/api/conversation-flows/simulate', {
        version_id: draft?.id,
        input: { profile_type: 'driver' },
      });
      const trace = Array.isArray(res.data.trace) ? res.data.trace.join(' → ') : '';
      setMessage(
        `Simulação (${res.data.format || '?'}): ${res.data.ok ? 'OK' : 'com avisos'} — ${(res.data.validation?.issues || []).join('; ') || 'sem issues'}${trace ? ` · trace: ${trace}` : ''}`
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Falha na simulação');
    }
  };

  const setRuntimeMode = async (mode: 'legacy' | 'shadow' | 'catalog' | 'flow') => {
    if (!isAdmin) return;
    await api.put('/api/conversation-flows/runtime-mode', { mode });
    await runtimeModeQuery.refetch();
  };

  const totalFlows = defsQuery.data?.length ?? 0;
  const activeFlows = useMemo(() => (defsQuery.data || []).filter((d) => d.is_active).length, [defsQuery.data]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-8 lg:px-8">
        <Link
          href="/automacoes"
          className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Automações
        </Link>

        <PageHeader
          eyebrow="Inteligência"
          title="Fluxos de atendimento"
          description="Fluxos versionados do motor conversacional — mesma edição em blocos que project-revive-main AutomacaoNova (passo 3), com JSON avançado opcional."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void defsQuery.refetch()}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover"
              >
                <RefreshCcw className="h-3.5 w-3.5" />
                Atualizar
              </button>
            </div>
          }
        />

        {/* Stats — project-revive-main Automacoes.tsx */}
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            {
              label: 'Fluxos ativos',
              value: `${activeFlows} / ${totalFlows || '—'}`,
            },
            {
              label: 'Definições no workspace',
              value: String(totalFlows),
            },
            {
              label: 'Modo runtime',
              value: runtimeModeQuery.data?.mode || 'catalog',
              accent: 'text-primary',
            },
            {
              label: 'Execuções agregadas',
              value: '—',
              accent: 'text-success',
            },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-surface p-4">
              <div className={cn('text-xl font-semibold tracking-tight', s.accent)}>{s.value}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Runtime strip (Revive stepper chrome) */}
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3">
          <span className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground">
            Motor inbound
          </span>
          <div className="flex flex-wrap gap-1.5">
            {(['legacy', 'shadow', 'catalog', 'flow'] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={!isAdmin}
                onClick={() => void setRuntimeMode(m)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
                  runtimeModeQuery.data?.mode === m
                    ? 'bg-primary/15 text-primary ring-1 ring-primary/25'
                    : 'text-muted-foreground hover:bg-surface-hover'
                )}
              >
                {m === 'flow' ? 'Fluxo publicado (v2)' : m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-subtle-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome ou slug..."
              className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-subtle-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        {/* Lista — project-revive-main Automacoes.tsx (tabela). Flows.tsx é rota separada no Revive. */}
        {!selectedId ? (
          <div
            className="overflow-visible rounded-xl border border-border bg-surface"
            onClick={() => setOpenMenuId(null)}
          >
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">
                  <th className="px-4 py-3">Fluxo</th>
                  <th className="px-4 py-3">Gatilho</th>
                  <th className="px-4 py-3 text-center">Slug</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                  <th className="w-8 px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {filteredDefs.map((def) => (
                  <tr
                    key={def.id}
                    onClick={() => setSelectedId(def.id)}
                    className="cursor-pointer border-b border-border/50 last:border-0 transition-colors hover:bg-surface-hover"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
                          <Bot className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="text-sm font-medium">{def.name}</div>
                          <div className="text-[10px] text-subtle-foreground">
                            ID: FLW-{def.id.slice(0, 8)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 rounded bg-background/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        <Play className="h-2.5 w-2.5" />
                        Mensagem recebida (motor)
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-[11px] text-muted-foreground">{def.slug}</td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={cn(
                          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                          def.is_active ? 'bg-primary' : 'bg-muted'
                        )}
                        onClick={(e) => e.stopPropagation()}
                        title="Somente leitura — alteração via API em breve."
                      >
                        <span
                          className={cn(
                            'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
                            def.is_active ? 'translate-x-5' : 'translate-x-1'
                          )}
                        />
                      </span>
                    </td>
                    <td className="relative px-4 py-3">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(openMenuId === def.id ? null : def.id);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded hover:bg-surface-elevated"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                      {openMenuId === def.id && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-2 top-10 z-20 w-48 rounded-lg border border-border bg-popover py-1 shadow-[var(--shadow-elevated)]"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedId(def.id);
                              setOpenMenuId(null);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-surface-hover"
                          >
                            <Pencil className="h-3.5 w-3.5" /> Editar fluxo
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard?.writeText(def.slug);
                              setOpenMenuId(null);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-surface-hover"
                          >
                            <Copy className="h-3.5 w-3.5" /> Copiar slug
                          </button>
                          <button
                            type="button"
                            disabled
                            className="flex w-full cursor-not-allowed items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground opacity-60"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Excluir (em breve)
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredDefs.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Nenhum fluxo encontrado. Definições surgem pelo provisionamento do workspace ou pela API.
              </p>
            ) : null}
          </div>
        ) : (
          <>
            {/* Editor — mesmo padrão AutomacaoNova.tsx passo 3 (PaletaBlocos + BlocoCard + ramos) */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(null);
                    setMessage(null);
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface hover:bg-surface-hover"
                >
                  <ArrowLeft className="h-4 w-4 text-muted-foreground" />
                </button>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">{selectedDefinition?.name}</span>
                    {publishedVersion ? (
                      <span className="rounded border border-success/25 bg-success/10 px-1.5 py-0.5 font-mono text-[10px] text-success">
                        Publicado v{publishedVersion.version_number}
                      </span>
                    ) : null}
                    {draftVersion ? (
                      <span className="rounded border border-warning/25 bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-warning">
                        Rascunho v{draftVersion.version_number}
                      </span>
                    ) : (
                      <span className="rounded border border-border bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        Sem rascunho
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[10px] text-subtle-foreground">{selectedDefinition?.slug}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={!canEditFlows}
                  onClick={() => void simulate()}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface-hover disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" />
                  Simular
                </button>
                <button
                  type="button"
                  disabled={!canEditFlows}
                  onClick={() => void saveDraft()}
                  className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-glow disabled:opacity-50"
                >
                  Salvar rascunho
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
              <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">Fluxo de atendimento</h2>
                    <p className="text-xs text-muted-foreground">
                      Editor em blocos (project-revive-main). Persiste em{' '}
                      <span className="font-mono">revive_blocos</span> no graph. Para o motor em produção, mantenha também
                      DSL v2 (<span className="font-mono">entry_node_id</span>) na aba JSON.
                    </p>
                  </div>
                  <div className="flex rounded-md border border-border bg-background/40 p-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (editorTab === 'json') {
                          try {
                            const parsed = JSON.parse(jsonString) as Record<string, unknown>;
                            setGraphDraft(parsed);
                            setMessage(null);
                          } catch {
                            setMessage('JSON inválido — corrija antes de voltar aos blocos.');
                            return;
                          }
                        }
                        setEditorTab('blocos');
                      }}
                      className={cn(
                        'rounded px-2.5 py-1 text-[11px] font-medium transition-colors',
                        editorTab === 'blocos' ? 'bg-surface-elevated text-foreground' : 'text-muted-foreground'
                      )}
                    >
                      Blocos
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (editorTab === 'blocos') {
                          setJsonString(JSON.stringify(graphDraft, null, 2));
                        }
                        setEditorTab('json');
                      }}
                      className={cn(
                        'rounded px-2.5 py-1 text-[11px] font-medium transition-colors',
                        editorTab === 'json' ? 'bg-surface-elevated text-foreground' : 'text-muted-foreground'
                      )}
                    >
                      JSON
                    </button>
                  </div>
                </div>

                <div className="mb-4 flex flex-wrap gap-2">
                  {(versionsQuery.data || []).map((version) => (
                    <div
                      key={version.id}
                      className="rounded-lg border border-border bg-background/40 px-3 py-2 text-xs font-mono"
                    >
                      v{version.version_number} · {version.status}
                      {version.status === 'draft' && canEditFlows ? (
                        <button
                          type="button"
                          onClick={() => void publishDraft(version.id)}
                          className="ml-2 text-primary underline"
                        >
                          Publicar
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>

                {canEditFlows ? (
                  <div className="mb-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void createDraftVersion()}
                      className="rounded-md border border-border bg-background/40 px-2 py-1 text-xs transition-colors hover:bg-surface-hover"
                    >
                      Novo rascunho vazio
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const latest = (versionsQuery.data || []).sort(
                          (a, b) => b.version_number - a.version_number
                        )[0];
                        if (latest) void createDraftVersion(latest.id);
                      }}
                      className="rounded-md border border-border bg-background/40 px-2 py-1 text-xs transition-colors hover:bg-surface-hover"
                    >
                      Novo rascunho da última versão
                    </button>
                  </div>
                ) : null}

                {draftVersion?.validation ? (
                  <div
                    className={cn(
                      'mb-4 rounded-lg border px-3 py-2 text-xs',
                      draftVersion.validation.valid
                        ? 'border-emerald-600/35 bg-emerald-600/8'
                        : 'border-amber-600/35 bg-amber-600/8'
                    )}
                  >
                    <span className="font-semibold">
                      Validação ({draftVersion.validation.format || 'legacy'}):{' '}
                      {draftVersion.validation.valid ? 'válido' : 'com pendências'}
                    </span>
                    {(draftVersion.validation.issues || []).length ? (
                      <ul className="mt-1 list-inside list-disc text-muted-foreground">
                        {(draftVersion.validation.issues || []).map((issue) => (
                          <li key={issue}>{issue}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}

                {editorTab === 'blocos' ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-background/40 px-3 py-2">
                      <p className="text-[11px] text-muted-foreground">
                        Mesma UX do Revive: paleta categorizada + cartões expansíveis e ramos.
                      </p>
                      <PaletaBlocos onAdd={(tipo) => setReviveBlocos([...reviveBlocos, novoBloco(tipo)])} />
                    </div>
                    {reviveBlocos.length === 0 ? (
                      <p className="rounded-lg border border-border/60 bg-background/30 px-3 py-6 text-center text-xs text-muted-foreground">
                        Nenhum bloco na raiz — use <strong className="text-foreground">Adicionar bloco</strong>.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {reviveBlocos.map((b) => (
                          <BlocoCard
                            key={b.id}
                            bloco={b}
                            onConfigChange={(id, key, value) =>
                              setReviveBlocos(updateBlocoConfig(reviveBlocos, id, key, value))
                            }
                            onRemove={(id) => setReviveBlocos(removeBloco(reviveBlocos, id))}
                            onToggle={(id) => setReviveBlocos(toggleCollapse(reviveBlocos, id))}
                            onAddToBranch={(parentId, ramo, tipo) =>
                              setReviveBlocos(addBlocoToBranch(reviveBlocos, parentId, ramo, novoBloco(tipo)))
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <label className="block">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground">
                      Graph JSON · rascunho
                    </span>
                    <textarea
                      value={jsonString}
                      onChange={(e) => setJsonString(e.target.value)}
                      spellCheck={false}
                      className="mt-2 min-h-[320px] w-full resize-y rounded-lg border border-border bg-background/60 p-3 font-mono text-xs leading-relaxed text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </label>
                )}

                {message ? (
                  <p className="mt-4 rounded-md border border-border bg-background/40 px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    {message}
                  </p>
                ) : null}
              </div>

              {/* Sidebar Revive */}
              <aside className="space-y-4">
                <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
                  <div className="mb-3 font-mono text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">
                    Resumo
                  </div>
                  <dl className="space-y-3 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Nome</dt>
                      <dd className="mt-0.5 font-medium">{selectedDefinition?.name}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Slug</dt>
                      <dd className="mt-0.5 font-mono text-[11px]">{selectedDefinition?.slug}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Formato (rascunho)</dt>
                      <dd className="mt-0.5 font-medium">{draftGraphPreview.format}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Nós</dt>
                      <dd className="mt-0.5 font-mono">{draftGraphPreview.nodeCount}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Versões</dt>
                      <dd className="mt-0.5 font-mono">{versionsQuery.data?.length ?? 0}</dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
                  <div className="mb-2 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">
                    <History className="h-3 w-3" />
                    Pré-visualização
                  </div>
                  <div className="space-y-1 font-mono text-[11px] text-muted-foreground">
                    <div>
                      modo runtime{' '}
                      <span className="text-primary">{runtimeModeQuery.data?.mode || 'catalog'}</span>
                    </div>
                    <div className="text-subtle-foreground">entrada · mensagens inbound</div>
                    <div className="text-foreground">então (rascunho):</div>
                    {draftGraphPreview.previewLines.length === 0 ? (
                      <div className="pl-3 italic">sem nós no rascunho</div>
                    ) : (
                      draftGraphPreview.previewLines.map((line, i) => (
                        <div key={`${line}-${i}`} className="pl-3">
                          {i + 1}. <span className="text-success">{line}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-border border-dashed bg-background/30 p-4">
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">
                    <Tag className="h-3 w-3" />
                    Notas
                  </div>
                  <ul className="list-inside list-disc space-y-1 text-[11px] text-muted-foreground">
                    <li>
                      Só <strong className="text-foreground">editor em blocos</strong> (
                      <span className="font-mono">revive_blocos</span>) não publica; inclua DSL v2 ou legado no JSON.
                    </li>
                    <li>Bindings (migration 030) escolhem qual definição publicada tem prioridade.</li>
                  </ul>
                </div>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
