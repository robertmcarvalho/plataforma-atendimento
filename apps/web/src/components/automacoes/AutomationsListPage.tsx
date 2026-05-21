'use client';

import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BarChart3, Bot, Clock, Copy, GitBranch, ListTree, MessageSquare, MoreHorizontal, Pencil, Play, Plus, Trash2, X, Zap } from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import Link from 'next/link';
import { OperationalContextBar } from '@/components/operational/OperationalContextBar';
import { useOperationalContext } from '@/hooks/useOperationalContext';

type ApiAutomationRule = {
  id: string;
  name: string;
  trigger_type: string;
  cron_expression: string | null;
  event_type: string | null;
  audience_type?: string | null;
  audience_filters?: Record<string, unknown> | null;
  template_id?: string | null;
  variables_mapping?: Record<string, unknown> | null;
  dispatch_config?: Record<string, unknown> | null;
  is_active: boolean;
  require_approval?: boolean;
  created_at: string;
  template?: { id: string; name: string } | null;
};

type RoutingRule = {
  id: string;
  name: string;
  priority: number;
  is_active: boolean;
  profile_type: 'driver' | 'pharmacy' | 'leader' | 'unknown' | null;
  intent: string | null;
  intent_sector_id: string | null;
  keywords_any: string[];
  keywords_all: string[];
  requires_context_pharmacy: boolean;
  route_to: 'sector' | 'pharmacy_attendant' | 'attendant';
  target_name: string | null;
  target_id: string | null;
  created_at: string;
};

type BotFlow = {
  id: string;
  name: string;
  trigger_keywords: string[];
  message: string;
  is_active: boolean;
  created_at: string;
};

type ConversationFlowDef = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  is_active?: boolean;
  created_at?: string;
};

type ConversationFlowBinding = {
  id: string;
  definition_id: string;
  workspace_channel_id?: string | null;
  is_active?: boolean;
};

type AutomationsStats = {
  days: number;
  runs_total: number;
  runs_completed: number;
  runs_failed: number;
  success_rate_pct: number | null;
};

type AutomationItem = {
  id: string;
  kind: 'automation_rule' | 'routing_rule' | 'bot_flow' | 'out_of_hours' | 'conversation_flow';
  name: string;
  trigger_label: string;
  actions_count: number | null;
  runs_count: number | null;
  success_pct: number | null;
  enabled: boolean;
  type: 'bot' | 'routing' | 'schedule' | 'financial' | 'csat' | 'reopen' | 'sla' | 'rule' | 'flow';
  raw: unknown;
  channel_ids?: string[];
};

const typeMeta: Record<AutomationItem['type'], { icon: typeof Bot; color: string }> = {
  bot: { icon: Bot, color: 'text-primary bg-primary/15' },
  routing: { icon: GitBranch, color: 'text-channel-instagram bg-channel-instagram/15' },
  schedule: { icon: Clock, color: 'text-warning bg-warning/15' },
  financial: { icon: Zap, color: 'text-success bg-success/15' },
  csat: { icon: MessageSquare, color: 'text-channel-whatsapp bg-channel-whatsapp/15' },
  reopen: { icon: Clock, color: 'text-muted-foreground bg-muted' },
  sla: { icon: Zap, color: 'text-destructive bg-destructive/15' },
  rule: { icon: MessageSquare, color: 'text-success bg-success/15' },
  flow: { icon: ListTree, color: 'text-primary bg-primary/15' },
};

function inferTypeFromNameOrEvent(name: string, eventType: string | null): AutomationItem['type'] {
  const n = String(name || '').toLowerCase();
  const e = String(eventType || '').toLowerCase();
  if (e.includes('bot') || n.includes('triag')) return 'bot';
  if (e.includes('route') || e.includes('routing') || n.includes('rotea')) return 'routing';
  if (e.includes('sla')) return 'sla';
  if (e.includes('installment') || n.includes('parcela') || n.includes('desconto')) return 'financial';
  if (e.includes('csat') || n.includes('csat')) return 'csat';
  if (n.includes('reabert') || n.includes('inativ')) return 'reopen';
  if (e.includes('schedule') || n.includes('hor') || n.includes('fora do')) return 'schedule';
  return 'rule';
}

function formatSuccess(success: number | null) {
  if (success === null || Number.isNaN(success)) return '—';
  const pct = Math.round(success * 10) / 10;
  return `${pct}%`;
}

function shortId(id: string) {
  const s = String(id || '');
  if (s.length <= 8) return s;
  return s.slice(0, 8);
}

export default function AutomationsListPage() {
  const router = useRouter();
  const isAuthenticated = useAuth((s) => s.isAuthenticated);
  const hasHydrated = useAuth((s) => s.hasHydrated);
  const userRole = useAuth((s) => s.user?.role || '');
  const isAdmin = String(userRole || '').toLowerCase() === 'admin';
  const isSupervisor = String(userRole || '').toLowerCase() === 'supervisor';
  const canFetch = hasHydrated && isAuthenticated;
  const { selectedChannel } = useOperationalContext({
    enabled: canFetch,
    channelTypes: ['whatsapp', 'instagram', 'email', 'webchat'],
  });

  const rulesQuery = useQuery({
    queryKey: ['settings-automations', 'automations'],
    enabled: canFetch,
    queryFn: async () => (await api.get('/api/automations')).data as ApiAutomationRule[],
  });

  const routingRulesQuery = useQuery({
    queryKey: ['settings-automations', 'routing-rules'],
    enabled: canFetch,
    queryFn: async () => (await api.get('/api/bot/routing-rules')).data as RoutingRule[],
  });

  const botFlowsQuery = useQuery({
    queryKey: ['settings-automations', 'bot-flows'],
    enabled: canFetch,
    queryFn: async () => (await api.get('/api/bot/flows')).data as BotFlow[],
  });

  const conversationFlowsQuery = useQuery({
    queryKey: ['settings-automations', 'conversation-flow-definitions'],
    enabled: canFetch,
    queryFn: async () => (await api.get('/api/conversation-flows/definitions')).data as ConversationFlowDef[],
  });

  const flowBindingQueries = useQueries({
    queries: (conversationFlowsQuery.data || []).map((flow) => ({
      queryKey: ['settings-automations', 'conversation-flow-bindings', flow.id] as const,
      enabled: canFetch,
      queryFn: async () =>
        (await api.get(`/api/conversation-flows/definitions/${flow.id}/bindings`)).data as ConversationFlowBinding[],
      staleTime: 60_000,
    })),
  });

  const flowChannelIdsByDefinition = useMemo(() => {
    const map = new Map<string, string[]>();
    const flows = conversationFlowsQuery.data || [];
    for (let idx = 0; idx < flows.length; idx += 1) {
      const flow = flows[idx];
      const bindings = flowBindingQueries[idx]?.data || [];
      map.set(
        flow.id,
        bindings
          .filter((binding) => binding.is_active !== false)
          .map((binding) => binding.workspace_channel_id)
          .filter((id): id is string => Boolean(id))
      );
    }
    return map;
  }, [conversationFlowsQuery.data, flowBindingQueries]);

  const statsQuery = useQuery({
    queryKey: ['settings-automations', 'stats', 30],
    enabled: canFetch,
    retry: false,
    queryFn: async () => {
      try {
        return (await api.get('/api/automations/runtime-stats?days=30')).data as AutomationsStats;
      } catch {
        return null;
      }
    },
  });

  const items = useMemo<AutomationItem[]>(() => {
    const rows: AutomationItem[] = [];

    for (const r of rulesQuery.data || []) {
      const triggerLabel =
        r.trigger_type === 'schedule'
          ? r.cron_expression
            ? `Cron: ${r.cron_expression}`
            : 'Agendado'
          : r.event_type
            ? r.event_type
            : 'Evento';

      rows.push({
        id: r.id,
        kind: 'automation_rule',
        name: r.name,
        trigger_label: triggerLabel,
        actions_count: null,
        runs_count: null,
        success_pct: null,
        enabled: Boolean(r.is_active),
        type: inferTypeFromNameOrEvent(r.name, r.event_type),
        raw: r,
      });
    }

    for (const rr of routingRulesQuery.data || []) {
      rows.push({
        id: rr.id,
        kind: 'routing_rule',
        name: rr.name,
        trigger_label: 'Mensagem recebida',
        actions_count: 1,
        runs_count: null,
        success_pct: null,
        enabled: Boolean(rr.is_active),
        type: 'routing',
        raw: rr,
      });
    }

    for (const bf of botFlowsQuery.data || []) {
      rows.push({
        id: bf.id,
        kind: 'bot_flow',
        name: bf.name,
        trigger_label: bf.trigger_keywords?.length ? `Keywords: ${bf.trigger_keywords.slice(0, 3).join(', ')}` : 'Nova conversa',
        actions_count: 1,
        runs_count: null,
        success_pct: null,
        enabled: Boolean(bf.is_active),
        type: 'bot',
        raw: bf,
      });
    }

    for (const fd of conversationFlowsQuery.data || []) {
      const channelIds = flowChannelIdsByDefinition.get(fd.id) || [];
      rows.push({
        id: fd.id,
        kind: 'conversation_flow',
        name: fd.name,
        trigger_label: 'Mensagem / conversa (binding)',
        actions_count: null,
        runs_count: null,
        success_pct: null,
        enabled: Boolean(fd.is_active ?? true),
        type: 'flow',
        raw: fd,
        channel_ids: channelIds,
      });
    }

    return rows;
  }, [rulesQuery.data, routingRulesQuery.data, botFlowsQuery.data, conversationFlowsQuery.data, flowChannelIdsByDefinition]);

  const visibleItems = useMemo(() => {
    if (!selectedChannel) return items;
    return items.filter((item) => {
      if (!item.channel_ids) return true;
      return item.channel_ids.length === 0 || item.channel_ids.includes(selectedChannel.id);
    });
  }, [items, selectedChannel]);

  const kpis = useMemo(() => {
    const active = visibleItems.filter((x) => x.enabled).length;
    const total = visibleItems.length;
    const runsMonth = statsQuery.data?.runs_total ?? null;
    const success = statsQuery.data?.success_rate_pct ?? null;
    return { active, total, runsMonth, success };
  }, [visibleItems, statsQuery.data]);

  const [openMenu, setOpenMenu] = useState<{ kind: AutomationItem['kind']; id: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AutomationItem | null>(null);

  const duplicateAutomationRule = async (rule: ApiAutomationRule) => {
    const body = {
      name: `${rule.name} (cópia)`,
      trigger_type: rule.trigger_type,
      cron_expression: rule.cron_expression || null,
      event_type: rule.event_type || null,
      audience_type: rule.audience_type || null,
      audience_filters: rule.audience_filters || {},
      template_id: rule.template_id || null,
      variables_mapping: rule.variables_mapping || {},
      dispatch_config: rule.dispatch_config || {},
      is_active: false,
      require_approval: Boolean(rule.require_approval),
    };
    await api.post('/api/automations', body);
    await rulesQuery.refetch();
  };

  const deleteItem = async (item: AutomationItem) => {
    if (item.kind === 'automation_rule') {
      if (!(isAdmin || isSupervisor)) return;
      await api.delete(`/api/automations/${item.id}`);
      await rulesQuery.refetch();
      await statsQuery.refetch();
      return;
    }
    if (item.kind === 'routing_rule') {
      if (!isAdmin) return;
      await api.delete(`/api/bot/routing-rules/${item.id}`);
      await routingRulesQuery.refetch();
      return;
    }
    if (item.kind === 'bot_flow') {
      if (!isAdmin) return;
      await api.delete(`/api/bot/flows/${item.id}`);
      await botFlowsQuery.refetch();
      return;
    }
    if (item.kind === 'conversation_flow') {
      if (!(isAdmin || isSupervisor)) return;
      await api.delete(`/api/conversation-flows/definitions/${item.id}`);
      await conversationFlowsQuery.refetch();
      return;
    }
  };

  const toggleItem = async (item: AutomationItem) => {
    if (item.kind === 'automation_rule') {
      if (!(isAdmin || isSupervisor)) return;
      await api.patch(`/api/automations/${item.id}/toggle`);
      await rulesQuery.refetch();
      await statsQuery.refetch();
      return;
    }
    if (item.kind === 'routing_rule') {
      if (!isAdmin) return;
      await api.patch(`/api/bot/routing-rules/${item.id}/toggle`);
      await routingRulesQuery.refetch();
      return;
    }
    if (item.kind === 'bot_flow') {
      if (!isAdmin) return;
      await api.patch(`/api/bot/flows/${item.id}/toggle`);
      await botFlowsQuery.refetch();
      return;
    }
    if (item.kind === 'conversation_flow') {
      if (!(isAdmin || isSupervisor)) return;
      await api.patch(`/api/conversation-flows/definitions/${item.id}`, { is_active: !item.enabled });
      await conversationFlowsQuery.refetch();
      return;
    }
  };

  return (
    <>
      <div className="h-full overflow-y-auto" onClick={() => setOpenMenu(null)}>
        <div className="mx-auto max-w-7xl px-8 py-8">
          <Link href="/settings" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Configurações
          </Link>

          <PageHeader
            eyebrow="Inteligência"
            title="Automações"
            description="Fluxos, bots de triagem e regras de roteamento."
            actions={
              <Link
                href="/automacoes/nova"
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> Nova automação
              </Link>
            }
          />

          <OperationalContextBar
            className="mb-6 rounded-xl border border-border"
            channelTypes={['whatsapp', 'instagram', 'email', 'webchat']}
            note="Filtro aplicado aos fluxos vinculados ao webhook"
          />

          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: 'Automações ativas', value: `${kpis.active} / ${kpis.total}` },
              { label: 'Execuções (mês)', value: kpis.runsMonth === null ? '—' : `${(kpis.runsMonth || 0).toLocaleString('pt-BR')}` },
              { label: 'Taxa de sucesso', value: kpis.success === null ? '—' : `${kpis.success.toFixed(1)}%`, accent: kpis.success === null ? '' : kpis.success >= 95 ? 'text-success' : kpis.success >= 85 ? 'text-warning' : 'text-destructive' },
              { label: 'Tempo médio economizado', value: '—', accent: 'text-primary' },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-border bg-surface p-4">
                <div className={cn('text-xl font-semibold tracking-tight', s.accent)}>{s.value}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="overflow-visible rounded-xl border border-border bg-surface">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-left text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">
                  <th className="px-4 py-3">Automação</th>
                  <th className="px-4 py-3">Gatilho</th>
                  <th className="px-4 py-3 text-center">Ações</th>
                  <th className="px-4 py-3 text-right">Execuções</th>
                  <th className="px-4 py-3 text-right">Sucesso</th>
                  <th className="px-4 py-3 text-center">Estado</th>
                  <th className="px-4 py-3 w-8" />
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((a) => {
                  const meta = typeMeta[a.type];
                  const Icon = meta.icon;
                  const trigger = a.trigger_label;
                  const successTone =
                    a.success_pct === null
                      ? 'text-subtle-foreground'
                      : a.success_pct >= 95
                        ? 'text-success'
                        : a.success_pct >= 85
                          ? 'text-warning'
                          : 'text-destructive';

                  return (
                    <tr
                      key={`${a.kind}:${a.id}`}
                      onClick={() => router.push(`/automacoes/${encodeURIComponent(a.id)}?kind=${encodeURIComponent(a.kind)}`)}
                      className="cursor-pointer border-b border-border/50 last:border-0 hover:bg-surface-hover transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', meta.color)}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{a.name}</div>
                            <div className="text-[10px] text-subtle-foreground">
                              ID:{' '}
                              {a.kind === 'automation_rule'
                                ? `AUT-${shortId(a.id)}`
                                : a.kind === 'conversation_flow'
                                  ? `FLX-${shortId(a.id)}`
                                  : shortId(a.id)}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 rounded bg-background/60 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                          <Play className="h-2.5 w-2.5" /> {trigger}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-xs">{a.actions_count ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm">{a.runs_count === null ? '—' : a.runs_count.toLocaleString('pt-BR')}</td>
                      <td className="px-4 py-3 text-right">
                        <span className={cn('font-mono text-sm', successTone)}>{formatSuccess(a.success_pct)}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void toggleItem(a);
                          }}
                          disabled={
                            a.kind === 'automation_rule' || a.kind === 'conversation_flow'
                              ? !(isAdmin || isSupervisor)
                              : !isAdmin
                          }
                          className={cn(
                            'relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-60 disabled:cursor-not-allowed',
                            a.enabled ? 'bg-primary' : 'bg-muted'
                          )}
                          title={a.enabled ? 'Desativar' : 'Ativar'}
                        >
                          <span className={cn('inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform', a.enabled ? 'translate-x-5' : 'translate-x-1')} />
                        </button>
                      </td>
                      <td className="relative px-4 py-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenu((cur) => (cur?.id === a.id && cur.kind === a.kind ? null : { kind: a.kind, id: a.id }));
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded hover:bg-surface-elevated"
                          title="Ações"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        {openMenu?.id === a.id && openMenu.kind === a.kind ? (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute right-2 top-10 z-20 w-48 rounded-lg border border-border bg-popover py-1 shadow-elevated"
                          >
                            <button
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-surface-hover"
                              onClick={() => {
                                setOpenMenu(null);
                                router.push(`/automacoes/nova?kind=${encodeURIComponent(a.kind)}&id=${encodeURIComponent(a.id)}`);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" /> Editar fluxo
                            </button>
                            <button
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-surface-hover"
                              onClick={() => {
                                setOpenMenu(null);
                                router.push(`/automacoes/${encodeURIComponent(a.id)}?kind=${encodeURIComponent(a.kind)}`);
                              }}
                            >
                              <BarChart3 className="h-3.5 w-3.5" /> Ver execuções
                            </button>
                            <button
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-surface-hover"
                              onClick={() => {
                                setOpenMenu(null);
                                if (a.kind === 'automation_rule') {
                                  const rule = (rulesQuery.data || []).find((r) => r.id === a.id);
                                  if (rule) void duplicateAutomationRule(rule);
                                  return;
                                }
                                router.push(`/automacoes/nova?cloneFromKind=${encodeURIComponent(a.kind)}&cloneFromId=${encodeURIComponent(a.id)}`);
                              }}
                            >
                              <Copy className="h-3.5 w-3.5" /> Duplicar
                            </button>
                            <button
                              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-surface-hover"
                              onClick={() => {
                                setOpenMenu(null);
                                setConfirmDelete(a);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Excluir
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {visibleItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      Nenhuma automação.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {confirmDelete ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-surface shadow-elevated"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="text-sm font-semibold">Excluir automação?</div>
              <button onClick={() => setConfirmDelete(null)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4 text-xs text-muted-foreground">
              Tem certeza que deseja excluir <span className="font-medium text-foreground">{confirmDelete.name}</span>?
              Esta ação não pode ser desfeita e o histórico de execuções será removido.
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-hover"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const item = confirmDelete;
                  setConfirmDelete(null);
                  void deleteItem(item);
                }}
                className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

