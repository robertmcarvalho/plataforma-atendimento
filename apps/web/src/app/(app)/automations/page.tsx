'use client';

import { automationsPageApi } from '@/lib/automations/automationsPageApi';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { Bot, Clock, GitBranch, MessageSquare, MoreHorizontal, Play, Plus, RefreshCcw, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Switch } from '@/components/ui/Switch';
import { useAuth } from '@/store/auth';
import { iconButtonHover, interactiveRowMuted, interactiveRowPrimary, interactiveRowSurface } from '@/lib/interactiveRow';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { cn } from '@/lib/utils';
import { formatDateTimeBr } from '@/lib/datetimeBr';
import { ToolCallMcpNode } from './components/ToolCallMcpNode';

type ApiTemplate = { id: string; name: string };

type ApiAutomationRule = {
  id: string;
  name: string;
  trigger_type: string;
  cron_expression: string | null;
  event_type: string | null;
  audience_type: string | null;
  template_id: string | null;
  template?: { id: string; name: string } | null;
  is_active: boolean;
  require_approval: boolean;
  created_at: string;
  updated_at: string;
};

type ApiAutomationRun = {
  id: string;
  status: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  started_at: string;
  completed_at: string | null;
};

type McpToolCatalogItem = {
  tool: string;
  title: string;
  actions: Array<{ action: string; description: string }>;
};

function Modal({
  open,
  title,
  children,
  onClose,
  maxWidthClassName = 'max-w-lg',
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  maxWidthClassName?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm p-4">
      <div className={cn('w-full rounded-2xl border border-border bg-muted shadow-md', maxWidthClassName)}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="text-sm font-semibold tracking-tight">{title}</div>
          <button onClick={onClose} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground">
            Fechar
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function typeMeta(rule: ApiAutomationRule) {
  const t = (rule.trigger_type || '').toLowerCase();
  const e = (rule.event_type || '').toLowerCase();
  if (e.includes('bot')) return { icon: Bot, color: 'text-primary bg-primary/15', label: 'Bot' };
  if (e.includes('route') || e.includes('routing')) return { icon: GitBranch, color: 'text-channel-instagram bg-channel-instagram/15', label: 'Roteamento' };
  if (t.includes('schedule') || rule.cron_expression) return { icon: Clock, color: 'text-warning bg-warning/15', label: 'Agenda' };
  if (e.includes('sla')) return { icon: Zap, color: 'text-destructive bg-destructive/15', label: 'SLA' };
  return { icon: MessageSquare, color: 'text-success bg-success/15', label: 'Regra' };
}

export default function AutomationsPage() {
  const isAuthenticated = useAuth((s) => s.isAuthenticated);
  const hasHydrated = useAuth((s) => s.hasHydrated);
  const canFetch = hasHydrated && isAuthenticated;

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formTrigger, setFormTrigger] = useState<'event' | 'schedule'>('event');
  const [formEventType, setFormEventType] = useState('bot');
  const [formCron, setFormCron] = useState('');
  const [formAudience, setFormAudience] = useState('drivers');
  const [formTemplateId, setFormTemplateId] = useState('');
  const [formUseMcp, setFormUseMcp] = useState(false);
  const [formMcpTool, setFormMcpTool] = useState('');
  const [formMcpAction, setFormMcpAction] = useState('');

  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [runsOpen, setRunsOpen] = useState(false);
  const [runsRule, setRunsRule] = useState<ApiAutomationRule | null>(null);

  const rulesQuery = useQuery({
    queryKey: ['automations'],
    enabled: canFetch,
    queryFn: async () => await automationsPageApi.list() as ApiAutomationRule[],
  });

  const templatesQuery = useQuery({
    queryKey: ['automations', 'templates-approved'],
    enabled: canFetch && createOpen,
    queryFn: async () => await automationsPageApi.listApprovedTemplates() as ApiTemplate[],
  });

  const mcpToolsQuery = useQuery({
    queryKey: ['automations', 'mcp-tools'],
    enabled: canFetch && createOpen && formUseMcp,
    queryFn: async () => await automationsPageApi.listMcpTools() as McpToolCatalogItem[],
  });

  const mcpActions = useMemo(() => {
    if (!formMcpTool) return [];
    const tool = (mcpToolsQuery.data || []).find((t) => t.tool === formMcpTool);
    return tool?.actions || [];
  }, [mcpToolsQuery.data, formMcpTool]);

  const runsQuery = useQuery({
    queryKey: ['automations', 'runs', runsRule?.id],
    enabled: canFetch && runsOpen && Boolean(runsRule?.id),
    queryFn: async () => await automationsPageApi.listRuns(runsRule!.id) as ApiAutomationRun[],
  });

  useEffect(() => {
    if (!menu) return;
    const onClick = (e: MouseEvent) => {
      const el = menuRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setMenu(null);
    };
    window.addEventListener('mousedown', onClick);
    const onResize = () => setMenu(null);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('resize', onResize);
    };
  }, [menu]);

  const items = useMemo(() => rulesQuery.data || [], [rulesQuery.data]);
  const kpis = useMemo(() => {
    const active = items.filter((r) => r.is_active).length;
    const total = items.length;
    return { active, total };
  }, [items]);

  const openCreate = () => {
    setFormName('');
    setFormTrigger('event');
    setFormEventType('bot');
    setFormCron('');
    setFormAudience('drivers');
    setFormTemplateId('');
    setFormUseMcp(false);
    setFormMcpTool('');
    setFormMcpAction('');
    setCreateError(null);
    setCreateOpen(true);
  };

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formTemplateId) return;
    if (formTrigger === 'schedule' && !formCron.trim()) return;
    if (formUseMcp && (!formMcpTool || !formMcpAction)) {
      setCreateError('Selecione tool e action do MCP para o Tool Call.');
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const body: Record<string, unknown> = {
        name: formName.trim(),
        trigger_type: formTrigger,
        event_type: formTrigger === 'event' ? formEventType.trim() : null,
        cron_expression: formTrigger === 'schedule' ? formCron.trim() : null,
        audience_type: formAudience,
        audience_filters: {},
        template_id: formTemplateId,
        variables_mapping: {},
        dispatch_config: formUseMcp
          ? {
              mcp: {
                tool: formMcpTool,
                action: formMcpAction,
              },
            }
          : {},
        is_active: false,
        require_approval: false,
      };
      await automationsPageApi.create(body);
      setCreateOpen(false);
      await rulesQuery.refetch();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setCreateError(msg || 'Falha ao criar automação.');
    } finally {
      setCreating(false);
    }
  };

  const toggleRule = async (rule: ApiAutomationRule) => {
    await automationsPageApi.toggle(rule.id);
    await rulesQuery.refetch();
  };

  const runNow = async (rule: ApiAutomationRule) => {
    await automationsPageApi.run(rule.id, {});
    await rulesQuery.refetch();
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-8 py-8">
        <PageHeader
          icon={Bot}
          eyebrow="Inteligência"
          title="Automações"
          description="Fluxos, bots de triagem e regras de roteamento."
          actions={
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void rulesQuery.refetch()} title="Atualizar">
                <RefreshCcw className="h-3.5 w-3.5" /> Atualizar
              </Button>
              <Button type="button" size="sm" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" /> Nova automação
              </Button>
            </div>
          }
        />

        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Automações ativas', value: `${kpis.active} / ${kpis.total}` },
            { label: 'Regras', value: String(kpis.total) },
            { label: 'Execuções (recentes)', value: '—' },
            { label: 'Taxa de sucesso', value: '—' },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-surface p-4">
              <div className={cn('text-xl font-semibold tracking-tight')}>{s.value}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        {rulesQuery.isError ? <div className="mb-3 text-xs text-destructive">Falha ao carregar automações.</div> : null}

        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">
                <th className="px-4 py-3">Automação</th>
                <th className="px-4 py-3">Gatilho</th>
                <th className="px-4 py-3 text-center">Estado</th>
                <th className="px-4 py-3 w-8" />
              </tr>
            </thead>
            <tbody>
              {rulesQuery.isLoading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-sm text-muted-foreground">
                    Carregando...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-sm text-muted-foreground">
                    Nenhuma automação.
                  </td>
                </tr>
              ) : (
                items.map((a) => {
                  const meta = typeMeta(a);
                  const Icon = meta.icon;
                  const trigger = a.trigger_type === 'schedule' ? `Cron: ${a.cron_expression || '—'}` : a.event_type || 'Evento';
                  return (
                    <tr key={a.id} className={cn('border-b border-border/50 last:border-0', interactiveRowSurface())}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', meta.color)}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className={cn('truncate text-sm font-medium', interactiveRowPrimary())}>{a.name}</div>
                            <div className={cn('text-[10px]', interactiveRowMuted())}>Template: {a.template?.name || '—'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 rounded bg-background/60 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                          <Play className="h-2.5 w-2.5" /> {trigger}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Switch
                          checked={a.is_active}
                          onCheckedChange={() => void toggleRule(a)}
                          title={a.is_active ? 'Desativar' : 'Ativar'}
                          aria-label={a.is_active ? 'Desativar' : 'Ativar'}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={(e) => {
                            const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                            setMenu((cur) => (cur?.id === a.id ? null : { id: a.id, x: rect.right, y: rect.bottom }));
                          }}
                          className={cn('flex h-7 w-7 items-center justify-center', iconButtonHover)}
                          title="Ações"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                        {menu?.id === a.id
                          ? createPortal(
                              <div
                                ref={menuRef}
                                style={{ position: 'fixed', top: menu.y + 6, left: menu.x, transform: 'translateX(-100%)' }}
                                className="z-[100] w-44 rounded-xl border border-border bg-muted p-1 shadow-md"
                              >
                                <button
                                  onClick={() => {
                                    setMenu(null);
                                    setRunsRule(a);
                                    setRunsOpen(true);
                                  }}
                                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-sidebar-accent/60"
                                >
                                  Ver execuções
                                </button>
                                <button
                                  onClick={() => {
                                    setMenu(null);
                                    void runNow(a);
                                  }}
                                  disabled={a.require_approval}
                                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-sidebar-accent/60 disabled:opacity-50"
                                >
                                  Executar agora
                                </button>
                              </div>,
                              document.body
                            )
                          : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={createOpen}
        title="Nova automação"
        onClose={() => {
          if (creating) return;
          setCreateOpen(false);
        }}
      >
        <form onSubmit={submitCreate} className="space-y-3">
          {createError ? <div className="text-xs text-destructive">{createError}</div> : null}
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Nome</label>
            <FormControl
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="mt-1"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Gatilho</label>
              <FormSelect
                value={formTrigger}
                onChange={(v) => setFormTrigger(v as 'event' | 'schedule')}
                className="mt-1"
                options={[
                  { value: 'event', label: 'Evento' },
                  { value: 'schedule', label: 'Agenda' },
                ]}
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">
                {formTrigger === 'schedule' ? 'Cron' : 'Event type'}
              </label>
              <FormControl
                value={formTrigger === 'schedule' ? formCron : formEventType}
                onChange={(e) => (formTrigger === 'schedule' ? setFormCron(e.target.value) : setFormEventType(e.target.value))}
                className="mt-1"
                placeholder={formTrigger === 'schedule' ? '0 9 * * 1-5' : 'bot'}
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Audiência</label>
            <FormSelect
              value={formAudience}
              onChange={setFormAudience}
              className="mt-1"
              options={[
                { value: 'drivers', label: 'Entregadores' },
                { value: 'leaders', label: 'Líderes' },
                { value: 'pharmacies', label: 'Farmácias' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Template</label>
            <FormSelect
              value={formTemplateId}
              onChange={setFormTemplateId}
              className="mt-1"
              placeholder="—"
              options={[
                { value: '', label: '—' },
                ...(templatesQuery.data || []).map((t) => ({ value: t.id, label: t.name })),
              ]}
            />
          </div>
          <ToolCallMcpNode
            enabled={formUseMcp}
            tool={formMcpTool}
            action={formMcpAction}
            tools={mcpToolsQuery.data || []}
            actions={mcpActions}
            loading={mcpToolsQuery.isLoading}
            error={mcpToolsQuery.isError}
            onToggle={(enabled) => {
              setFormUseMcp(enabled);
              if (!enabled) {
                setFormMcpTool('');
                setFormMcpAction('');
              }
            }}
            onToolChange={(tool) => {
              setFormMcpTool(tool);
              setFormMcpAction('');
            }}
            onActionChange={setFormMcpAction}
          />
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancelar
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? 'Salvando...' : 'Criar'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={runsOpen}
        title={runsRule ? `Execuções: ${runsRule.name}` : 'Execuções'}
        onClose={() => setRunsOpen(false)}
        maxWidthClassName="max-w-2xl"
      >
        {runsQuery.isError ? <div className="text-xs text-destructive">Falha ao carregar execuções.</div> : null}
        {runsQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando...</div>
        ) : (runsQuery.data || []).length === 0 ? (
          <div className="text-sm text-muted-foreground">Nenhuma execução.</div>
        ) : (
          <div className="space-y-2">
            {(runsQuery.data || []).slice(0, 20).map((r) => (
              <div key={r.id} className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between text-xs">
                  <div className="font-medium text-foreground">{r.status}</div>
                  <div className="font-mono text-xs text-subtle-foreground">
                    {formatDateTimeBr(r.started_at)}
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {[
                    { label: 'Destinatários', val: r.total_recipients },
                    { label: 'Enviadas', val: r.sent_count },
                    { label: 'Falhas', val: r.failed_count },
                  ].map((s) => (
                    <div key={s.label} className="rounded-md bg-background/60 px-3 py-2">
                      <div className="font-mono text-sm font-semibold text-foreground">{Number(s.val || 0).toLocaleString('pt-BR')}</div>
                      <div className="text-[10px] text-subtle-foreground">{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

