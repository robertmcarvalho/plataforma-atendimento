'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Clock, FileText, GitBranch, History, Loader2, Pause, Pencil, Play, Tag, type LucideIcon } from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { countBlocos, labelOf, type Bloco } from '@/lib/conversation-flow/fluxo';
import { revivePreviewNumberedLines } from '@/lib/conversation-flow/wizardConversationFlow';
import { useAuth } from '@/store/auth';

type AutomationKind = 'automation_rule' | 'routing_rule' | 'bot_flow' | 'out_of_hours' | 'conversation_flow';

type FlowDefinition = {
  id: string;
  slug?: string;
  name: string;
  description?: string | null;
  is_active?: boolean;
  created_at?: string;
};

type FlowVersion = {
  id: string;
  version_number: number;
  status: string;
  graph?: Record<string, unknown>;
  validation?: { valid?: boolean; issues?: string[]; format?: string };
  created_at?: string;
  published_at?: string | null;
};

type FlowBinding = {
  id: string;
  trigger_type?: string;
  workspace_channel_id?: string | null;
  keywords?: string[];
  priority?: number;
  is_active?: boolean;
};

type AutomationRule = {
  id: string;
  name: string;
  is_active?: boolean;
  event_type?: string | null;
  trigger_type?: string | null;
};

type AutomationRun = {
  id: string;
  status: string;
  total_recipients?: number;
  sent_count?: number;
  failed_count?: number;
  started_at?: string;
  completed_at?: string | null;
};

const detailTabs: Array<{ value: 'overview' | 'runs' | 'logs' | 'versions'; label: string; icon: LucideIcon }> = [
  { value: 'overview', label: 'Visão geral', icon: GitBranch },
  { value: 'runs', label: 'Execuções', icon: Play },
  { value: 'logs', label: 'Logs', icon: FileText },
  { value: 'versions', label: 'Versões', icon: History },
];

function extractPreset(graph?: Record<string, unknown>) {
  const meta = (graph?.wizard_meta || {}) as Record<string, unknown>;
  return String(meta.preset || 'triagem_perfil');
}

function graphSummary(graph?: Record<string, unknown>) {
  const blocos = Array.isArray(graph?.revive_blocos) ? (graph!.revive_blocos as Bloco[]) : [];
  if (blocos.length) {
    return {
      format: 'Editor blocos (Revive)',
      count: countBlocos(blocos),
      lines: revivePreviewNumberedLines(blocos, 18),
      tags: blocos.filter((b) => b.tipo === 'aplicar-tag').map((b) => String(b.config.tag || '')).filter(Boolean),
    };
  }
  const nodes = graph?.nodes;
  const count = Array.isArray(nodes)
    ? nodes.length
    : nodes && typeof nodes === 'object'
      ? Object.keys(nodes as Record<string, unknown>).length
      : 0;
  return { format: 'Fluxo técnico', count, lines: [`${count} nós configurados`], tags: [] as string[] };
}

function statusLabel(active: boolean) {
  return active ? 'Ativa' : 'Pausada';
}

export default function AutomationDetailPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const id = String(params.id || '');
  const kind = (search.get('kind') || 'conversation_flow') as AutomationKind;
  const role = String(useAuth((s) => s.user?.role || '')).toLowerCase();
  const canEdit = role === 'admin' || role === 'supervisor';
  const [tab, setTab] = useState<'overview' | 'runs' | 'logs' | 'versions'>('overview');

  const defsQuery = useQuery({
    queryKey: ['automation-detail', 'flow-definitions'],
    enabled: kind === 'conversation_flow',
    queryFn: async () => (await api.get('/api/conversation-flows/definitions')).data as FlowDefinition[],
  });

  const versionsQuery = useQuery({
    queryKey: ['automation-detail', 'flow-versions', id],
    enabled: kind === 'conversation_flow' && Boolean(id),
    queryFn: async () => (await api.get(`/api/conversation-flows/definitions/${id}/versions`)).data as FlowVersion[],
  });

  const bindingsQuery = useQuery({
    queryKey: ['automation-detail', 'flow-bindings', id],
    enabled: kind === 'conversation_flow' && Boolean(id),
    retry: false,
    queryFn: async () => (await api.get(`/api/conversation-flows/definitions/${id}/bindings`)).data as FlowBinding[],
  });

  const runsQuery = useQuery({
    queryKey: ['automation-detail', 'runs', kind, id],
    enabled: kind === 'automation_rule' && Boolean(id),
    retry: false,
    queryFn: async () => (await api.get(`/api/automations/${id}/runs`)).data as AutomationRun[],
  });

  const automationRulesQuery = useQuery({
    queryKey: ['automation-detail', 'automation-rules'],
    enabled: kind === 'automation_rule',
    queryFn: async () => (await api.get('/api/automations')).data as AutomationRule[],
  });

  const definition = useMemo(
    () => (defsQuery.data || []).find((d) => d.id === id) || null,
    [defsQuery.data, id]
  );
  const automationRule = useMemo(
    () => (automationRulesQuery.data || []).find((r) => r.id === id) || null,
    [automationRulesQuery.data, id]
  );

  const latestVersion = useMemo(() => {
    return [...(versionsQuery.data || [])].sort((a, b) => b.version_number - a.version_number)[0] || null;
  }, [versionsQuery.data]);

  const summary = useMemo(() => graphSummary(latestVersion?.graph), [latestVersion?.graph]);
  const preset = extractPreset(latestVersion?.graph);
  const active =
    kind === 'conversation_flow'
      ? Boolean(definition?.is_active ?? true)
      : kind === 'automation_rule'
        ? Boolean(automationRule?.is_active ?? true)
        : true;

  const toggleAutomation = async () => {
    if (!canEdit) return;
    if (kind === 'conversation_flow' && definition) {
      await api.patch(`/api/conversation-flows/definitions/${id}`, { is_active: !active });
      await defsQuery.refetch();
    }
    if (kind === 'automation_rule' && automationRule) {
      await api.patch(`/api/automations/${id}/toggle`);
      await automationRulesQuery.refetch();
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-8 py-8">
        <Link href="/automacoes" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Automações
        </Link>

        <div className="mb-6 flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-border bg-surface p-6">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">Detalhe da automação</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
              {definition?.name || automationRule?.name || (kind === 'conversation_flow' ? 'Carregando fluxo...' : `Automação ${id.slice(0, 8)}`)}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {definition?.description || 'Visão operacional com estrutura do fluxo, execuções, logs e versões.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {kind === 'conversation_flow' || kind === 'automation_rule' ? (
              <button
                type="button"
                onClick={() => void toggleAutomation()}
                disabled={!canEdit || (kind === 'conversation_flow' ? !definition : !automationRule)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-hover disabled:opacity-50"
              >
                {active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {active ? 'Pausar' : 'Ativar'}
              </button>
            ) : null}
            <Link
              href={`/automacoes/nova?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow"
            >
              <Pencil className="h-3.5 w-3.5" />
              Editar fluxo
            </Link>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Estado', value: statusLabel(active), accent: active ? 'text-success' : 'text-warning' },
            { label: 'Blocos / nós', value: String(summary.count), accent: 'text-primary' },
            { label: 'Versões', value: String(versionsQuery.data?.length ?? '—') },
            { label: 'Preset', value: preset.replaceAll('_', ' ') },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-xl border border-border bg-surface p-4">
              <div className={cn('text-xl font-semibold tracking-tight capitalize', kpi.accent)}>{kpi.value}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{kpi.label}</div>
            </div>
          ))}
        </div>

        <div className="mb-4 flex flex-wrap gap-2 rounded-xl border border-border bg-surface p-2">
          {detailTabs.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                tab === value ? 'bg-primary/15 text-primary ring-1 ring-primary/25' : 'text-muted-foreground hover:bg-surface-hover'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        {versionsQuery.isLoading && kind === 'conversation_flow' ? (
          <div className="rounded-xl border border-border bg-surface p-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Carregando automação...
          </div>
        ) : tab === 'overview' ? (
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="rounded-xl border border-border bg-surface p-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-foreground">Estrutura do fluxo</div>
                  <div className="text-xs text-muted-foreground">{summary.format}</div>
                </div>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="space-y-1 rounded-lg border border-border bg-background/40 p-3 font-mono text-xs text-muted-foreground">
                {summary.lines.map((line, index) => (
                  <div key={`${line}-${index}`}>{line}</div>
                ))}
              </div>
            </div>
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-surface p-5">
                <div className="text-sm font-semibold text-foreground">Detalhes</div>
                <dl className="mt-3 space-y-2 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">ID</dt>
                    <dd className="font-mono text-foreground">{id.slice(0, 8)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Tipo</dt>
                    <dd className="text-foreground">{kind}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Gatilho</dt>
                    <dd className="text-foreground">
                      {automationRule?.event_type || automationRule?.trigger_type || bindingsQuery.data?.[0]?.trigger_type || '—'}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="rounded-xl border border-border bg-surface p-5">
                <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <Tag className="h-3.5 w-3.5" />
                  Tags
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(summary.tags.length ? summary.tags : ['webhook operacional', preset]).map((tag) => (
                    <span key={tag} className="rounded-full border border-border bg-background/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : tab === 'versions' ? (
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="mb-3 text-sm font-semibold text-foreground">Versões</div>
            <div className="space-y-2">
              {(versionsQuery.data || []).map((version) => (
                <div key={version.id} className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2 text-xs">
                  <span className="font-medium text-foreground">v{version.version_number}</span>
                  <span className="text-muted-foreground">{version.status}</span>
                  <span className="text-muted-foreground">{version.validation?.format || '—'} · {version.validation?.valid === false ? 'com alertas' : 'válida'}</span>
                </div>
              ))}
            </div>
          </div>
        ) : tab === 'runs' ? (
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="mb-3 text-sm font-semibold text-foreground">Execuções</div>
            {(runsQuery.data || []).length ? (
              <div className="space-y-2">
                {(runsQuery.data || []).map((run) => (
                  <div key={run.id} className="grid grid-cols-4 gap-3 rounded-lg border border-border bg-background/40 px-3 py-2 text-xs">
                    <span className="font-mono text-foreground">{run.status}</span>
                    <span className="text-muted-foreground">Destinatários: {run.total_recipients ?? '—'}</span>
                    <span className="text-muted-foreground">Enviados: {run.sent_count ?? '—'}</span>
                    <span className="text-muted-foreground">{String(run.started_at || '').slice(0, 19).replace('T', ' ')}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma execução registrada para este contrato ainda.</p>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-surface p-5">
            <div className="mb-3 text-sm font-semibold text-foreground">Logs</div>
            <div className="rounded-lg border border-border bg-background/40 p-3 font-mono text-xs text-muted-foreground">
              <div>[detail] automação: {id}</div>
              <div>[runtime] fonte operacional: workspace_channels.config</div>
              <div>[binding] {bindingsQuery.data?.[0]?.trigger_type || 'sem binding carregado'}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
