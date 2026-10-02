'use client';

import { campaignsPageApi } from '@/lib/campaigns/campaignsPageApi';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Megaphone,
  MessageSquare,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Send,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DEFAULT_LIST_PAGE_SIZE, PaginationControls } from '@/components/ui/PaginationControls';
import { FormControl, formTextareaClassName } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { useAuth } from '@/store/auth';
import { cn } from '@/lib/utils';
import { formatDayMonthTimeBr } from '@/lib/datetimeBr';
import { normalizeBrazilPhone } from '@/lib/brFormat';

type CampaignStatus = 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'failed';
type CampaignType = 'manual' | 'scheduled' | 'automated';
type AudienceType = 'drivers' | 'leaders' | 'pharmacies' | 'custom';

type ApiTemplate = { id: string; name: string; category?: string | null };

type ApiCampaign = {
  id: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  template_id: string | null;
  template?: ApiTemplate | null;
  audience_type: AudienceType | null;
  audience_filters?: Record<string, unknown> | null;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  total_recipients: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
  created_at: string;
  updated_at: string;
};

const statusMeta: Record<CampaignStatus, { label: string; color: string; icon: typeof Play }> = {
  running: { label: 'Em execução', color: 'bg-success/15 text-success', icon: Play },
  scheduled: { label: 'Agendada', color: 'bg-primary/15 text-primary', icon: Clock },
  completed: { label: 'Concluída', color: 'bg-muted text-muted-foreground', icon: CheckCircle2 },
  paused: { label: 'Pausada', color: 'bg-warning/15 text-warning', icon: Pause },
  draft: { label: 'Rascunho', color: 'bg-muted/50 text-subtle-foreground', icon: AlertCircle },
  failed: { label: 'Falhou', color: 'bg-destructive/15 text-destructive', icon: AlertCircle },
};

function pct(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function formatCompactNumber(n: number) {
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
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
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface shadow-md">
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

export default function CampaignsPage() {
  const isAuthenticated = useAuth((s) => s.isAuthenticated);
  const hasHydrated = useAuth((s) => s.hasHydrated);
  const canFetch = hasHydrated && isAuthenticated;

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<CampaignType>('manual');
  const [formScheduledAt, setFormScheduledAt] = useState('');
  const [formTemplateId, setFormTemplateId] = useState('');
  const [formAudience, setFormAudience] = useState<AudienceType>('drivers');
  const [formPhones, setFormPhones] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const campaignsQuery = useQuery({
    queryKey: ['campaigns'],
    enabled: canFetch,
    queryFn: async () => await campaignsPageApi.list() as ApiCampaign[],
  });

  const templatesQuery = useQuery({
    queryKey: ['campaigns', 'templates-approved'],
    enabled: canFetch && createOpen,
    queryFn: async () => await campaignsPageApi.listApprovedTemplates() as ApiTemplate[],
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

  const items = useMemo(() => campaignsQuery.data ?? [], [campaignsQuery.data]);
  const pagedItems = useMemo(() => {
    const start = (currentPage - 1) * DEFAULT_LIST_PAGE_SIZE;
    return items.slice(start, start + DEFAULT_LIST_PAGE_SIZE);
  }, [currentPage, items]);

  const kpis = useMemo(() => {
    const monthSince = startOfMonth();
    const monthItems = items.filter((c) => {
      const t = new Date(c.started_at || c.created_at).getTime();
      return Number.isFinite(t) && t >= monthSince;
    });
    const sent = monthItems.reduce((acc, c) => acc + (c.sent_count || 0), 0);
    const delivered = monthItems.reduce((acc, c) => acc + (c.delivered_count || 0), 0);
    const read = monthItems.reduce((acc, c) => acc + (c.read_count || 0), 0);
    const deliveryRate = sent > 0 ? Math.round((delivered / sent) * 1000) / 10 : 0;
    const readRate = sent > 0 ? Math.round((read / sent) * 1000) / 10 : 0;
    return { sent, deliveryRate, readRate };
  }, [items]);

  useEffect(() => {
    setCurrentPage(1);
  }, [items.length]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(items.length / DEFAULT_LIST_PAGE_SIZE));
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, items.length]);

  const openCreate = () => {
    setFormName('');
    setFormType('manual');
    setFormScheduledAt('');
    setFormTemplateId('');
    setFormAudience('drivers');
    setFormPhones('');
    setCreateError(null);
    setCreateOpen(true);
  };

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formTemplateId) return;
    if (formType === 'scheduled' && !formScheduledAt) return;
    if (formAudience === 'custom' && !formPhones.trim()) return;

    setCreating(true);
    setCreateError(null);
    try {
      const body: {
        name: string;
        type: CampaignType;
        template_id: string;
        audience_type: AudienceType;
        audience_filters: { phones?: string[] };
        scheduled_at?: string;
      } = {
        name: formName.trim(),
        type: formType,
        template_id: formTemplateId,
        audience_type: formAudience,
        audience_filters:
          formAudience === 'custom'
            ? { phones: formPhones.split(/\r?\n/).map((x) => normalizeBrazilPhone(x)).filter(Boolean) }
            : {},
      };
      if (formType === 'scheduled') body.scheduled_at = new Date(formScheduledAt).toISOString();
      await campaignsPageApi.create(body);
      setCreateOpen(false);
      await campaignsQuery.refetch();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setCreateError(msg || 'Falha ao criar campanha.');
    } finally {
      setCreating(false);
    }
  };

  const pauseCampaign = async (id: string) => {
    await campaignsPageApi.pause(id);
    await campaignsQuery.refetch();
  };

  const resumeCampaign = async (id: string) => {
    await campaignsPageApi.resume(id);
    await campaignsQuery.refetch();
  };

  const dispatchCampaign = async (id: string) => {
    await campaignsPageApi.dispatch(id);
    await campaignsQuery.refetch();
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-8 py-8">
        <PageHeader
          icon={Megaphone}
          eyebrow="Engajamento"
          title="Campanhas"
          description="Disparos em massa via WhatsApp com templates aprovados."
          actions={
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void campaignsQuery.refetch()} title="Atualizar">
                <RefreshCcw className="h-3.5 w-3.5" /> Atualizar
              </Button>
              <Button type="button" size="sm" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" /> Nova campanha
              </Button>
            </div>
          }
        />

        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Mensagens enviadas (mês)', value: formatCompactNumber(kpis.sent), icon: Send },
            { label: 'Taxa de entrega', value: `${kpis.deliveryRate.toFixed(1)}%`, accent: kpis.deliveryRate > 0 ? 'text-success' : undefined, icon: CheckCircle2 },
            { label: 'Taxa de leitura', value: `${kpis.readRate.toFixed(1)}%`, accent: kpis.readRate > 0 ? 'text-primary' : undefined, icon: MessageSquare },
            { label: 'Campanhas', value: String(items.length), icon: Users },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center justify-between">
                <s.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className={cn('mt-3 text-xl font-semibold tracking-tight', s.accent)}>{s.value}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>

        {campaignsQuery.isError ? <div className="mb-3 text-xs text-destructive">Falha ao carregar campanhas.</div> : null}

        <div className="space-y-3">
          {campaignsQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Carregando...</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-muted-foreground">Nenhuma campanha.</div>
          ) : (
            pagedItems.map((c) => {
              const meta = statusMeta[c.status];
              const Icon = meta.icon;
              const recipients = c.total_recipients || 0;
              const sent = c.sent_count || 0;
              const progress = recipients > 0 ? pct((sent / recipients) * 100) : 0;
              const when =
                c.status === 'scheduled'
                  ? formatDayMonthTimeBr(c.scheduled_at)
                  : c.status === 'running'
                    ? 'Em andamento'
                    : formatDayMonthTimeBr(c.started_at);
              return (
                <div key={c.id} className="group rounded-xl border border-border bg-surface p-5 transition-colors hover:bg-sidebar-accent/40 hover:border-primary/40">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold tracking-tight truncate">{c.name}</h3>
                        <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium', meta.color)}>
                          <Icon className="h-2.5 w-2.5" /> {meta.label}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="font-mono">{c.template?.name || '—'}</span>
                        <span>·</span>
                        <span>{when}</span>
                        <span>·</span>
                        <span>{recipients.toLocaleString('pt-BR')} destinatários</span>
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                        setMenu((cur) => (cur?.id === c.id ? null : { id: c.id, x: rect.right, y: rect.bottom }));
                      }}
                      className="rounded p-1.5 text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                      title="Ações"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    {menu?.id === c.id
                      ? createPortal(
                          <div
                            ref={menuRef}
                            style={{ position: 'fixed', top: menu.y + 6, left: menu.x, transform: 'translateX(-100%)' }}
                            className="z-[100] w-44 rounded-xl border border-border bg-surface p-1 shadow-md"
                          >
                            <button
                              onClick={() => {
                                setMenu(null);
                                void dispatchCampaign(c.id);
                              }}
                              disabled={!['draft', 'scheduled'].includes(c.status)}
                              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-sidebar-accent/60 disabled:opacity-50"
                            >
                              Disparar agora
                            </button>
                            <button
                              onClick={() => {
                                setMenu(null);
                                void pauseCampaign(c.id);
                              }}
                              disabled={c.status !== 'running'}
                              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-sidebar-accent/60 disabled:opacity-50"
                            >
                              Pausar
                            </button>
                            <button
                              onClick={() => {
                                setMenu(null);
                                void resumeCampaign(c.id);
                              }}
                              disabled={c.status !== 'paused'}
                              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs text-foreground hover:bg-sidebar-accent/60 disabled:opacity-50"
                            >
                              Retomar
                            </button>
                          </div>,
                          document.body
                        )
                      : null}
                  </div>

                  {['running', 'paused', 'completed'].includes(c.status) ? (
                    <div className="mt-4">
                      <div className="flex items-center justify-between text-[10px] font-mono text-subtle-foreground mb-1.5">
                        <span>
                          {sent.toLocaleString('pt-BR')} / {recipients.toLocaleString('pt-BR')}
                        </span>
                        <span>{progress}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-background/60">
                        <div
                          className={cn(
                            'h-full transition-all',
                            c.status === 'completed' ? 'bg-success' : c.status === 'paused' ? 'bg-warning' : 'bg-gradient-to-r from-primary to-primary-glow'
                          )}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  ) : null}

                  {sent > 0 ? (
                    <div className="mt-4 grid grid-cols-4 gap-2">
                      {[
                        { label: 'Enviadas', val: c.sent_count, color: 'text-foreground' },
                        { label: 'Entregues', val: c.delivered_count, color: 'text-primary' },
                        { label: 'Lidas', val: c.read_count, color: 'text-channel-whatsapp' },
                        { label: 'Falhas', val: c.failed_count, color: 'text-destructive' },
                      ].map((s) => (
                        <div key={s.label} className="rounded-md bg-background/40 px-3 py-2">
                          <div className={cn('font-mono text-sm font-semibold', s.color)}>{Number(s.val || 0).toLocaleString('pt-BR')}</div>
                          <div className="text-[10px] text-subtle-foreground">{s.label}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
        <PaginationControls page={currentPage} totalItems={items.length} onPageChange={setCurrentPage} itemLabel="campanhas" />
      </div>

      <Modal
        open={createOpen}
        title="Nova campanha"
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
              <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Tipo</label>
              <FormSelect
                value={formType}
                onChange={(v) => setFormType(v as CampaignType)}
                className="mt-1"
                options={[
                  { value: 'manual', label: 'Manual' },
                  { value: 'scheduled', label: 'Agendada' },
                ]}
              />
            </div>
            <div>
              <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Agendar para</label>
              <FormControl
                value={formScheduledAt}
                onChange={(e) => setFormScheduledAt(e.target.value)}
                disabled={formType !== 'scheduled'}
                type="datetime-local"
                className="mt-1 disabled:opacity-60"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Template</label>
            <FormSelect
              value={formTemplateId}
              onChange={setFormTemplateId}
              className="mt-1"
              placeholder="—"
              options={(templatesQuery.data || []).map((t) => ({ value: t.id, label: t.name }))}
            />
            <div className="mt-1 text-[11px] text-muted-foreground">Somente templates aprovados aparecem aqui.</div>
          </div>
          <div>
            <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Audiência</label>
            <FormSelect
              value={formAudience}
              onChange={(v) => setFormAudience(v as AudienceType)}
              className="mt-1"
              options={[
                { value: 'drivers', label: 'Entregadores' },
                { value: 'leaders', label: 'Líderes' },
                { value: 'pharmacies', label: 'Farmácias' },
                { value: 'custom', label: 'Custom (telefones)' },
              ]}
            />
          </div>
          {formAudience === 'custom' ? (
            <div>
              <label className="block text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Telefones (um por linha)</label>
              <textarea
                value={formPhones}
                onChange={(e) => setFormPhones(e.target.value)}
                className={cn(formTextareaClassName, 'mt-1 min-h-[96px] font-mono')}
                placeholder="(11) 99999-9999 ou +55 11 99999-9999"
                required
              />
            </div>
          ) : null}
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
    </div>
  );
}

