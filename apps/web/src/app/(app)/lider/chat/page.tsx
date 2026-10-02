'use client';

import { leaderPortalPageApi } from '@/lib/leaderPortal/leaderPortalPageApi';
import { inboxPageApi } from '@/lib/inbox/inboxPageApi';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Headphones, MessageCircle, Phone, Plus, Search, Smile } from 'lucide-react';
import { LeaderPage } from '@/components/leader/LeaderPage';
import { useIsLgUp } from '@/hooks/useMediaQuery';
import { PageHeader } from '@/components/ui/PageHeader';
import { MessageBubble, type MessageBubbleModel } from '@/components/ui/MessageBubble';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import { FormControl, formTextareaClassName } from '@/components/form/FormControl';
import { useAuth } from '@/store/auth';
import { LeaderIntakeWizard } from '@/components/leader/LeaderIntakeWizard';
import { LeaderWhatsAppOtpModal } from '@/components/leader/LeaderWhatsAppOtpModal';
import { LeaderWhatsAppStatusButton, type LeaderWhatsAppStatus } from '@/components/leader/LeaderWhatsAppStatusButton';

type LeaderMe = {
  leader: { id: string; name: string; phone: string | null };
  whatsapp: {
    connected: boolean;
    status: LeaderWhatsAppStatus;
    phone_e164?: string | null;
    business_e164: string | null;
    verified_at?: string | null;
    expires_at?: string | null;
  };
};

type ConversationRow = {
  id: string;
  status?: string | null;
  created_at?: string | null;
  last_message_at?: string | null;
  sectors?: { id: string; name: string } | null;
};

function demandLabelFromConversation(detail: { summary?: string | null; demand_key?: string | null } | null | undefined): string {
  if (!detail) return '—';
  const fromSummary = detail.summary?.match(/demanda\s+([^·]+)/i)?.[1]?.trim();
  if (fromSummary) return fromSummary;
  const key = String(detail.demand_key || '').trim();
  if (!key) return '—';
  if (/^[a-z0-9-]+$/i.test(key)) {
    return key
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return key;
}

type ConversationDetail = {
  id: string;
  summary?: string | null;
  demand_key?: string | null;
  context_pharmacy?: { id: string; trade_name?: string } | null;
  context_driver?: { id: string; name?: string } | null;
  sectors?: { id: string; name: string } | null;
  messages?: Array<{
    id: string;
    direction: 'inbound' | 'outbound';
    type: string;
    content: string;
    media_url?: string | null;
    created_at: string;
    status?: string | null;
  }>;
};

type LeaderStats = {
  pharmacies_count: number;
  drivers_count: number;
  pending_absences: number;
  pending_dailies: number;
};

function timeAgoLabel(value?: string | null) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function sectorContext(name: string) {
  const n = name.toLowerCase();
  if (n.includes('fin')) {
    return {
      desc: 'Adiantamentos, descontos, diárias, fechamento e dúvidas de extrato.',
      examples: 'Ex.: contestar desconto, acompanhar pagamento, validar diária.',
    };
  }
  if (n.includes('suporte') || n.includes('tec')) {
    return {
      desc: 'App, acesso, plataforma, lentidão e problemas técnicos.',
      examples: 'Ex.: erro no app, dificuldade de login, falha operacional.',
    };
  }
  if (n.includes('opera') || n.includes('rh')) {
    return {
      desc: 'Escala, faltas, cobertura, ocorrências e rotina em campo.',
      examples: 'Ex.: falta de entregador, cobertura emergencial, atraso.',
    };
  }
  return {
    desc: 'Documentos, MEI, certificados, benefícios e dúvidas gerais.',
    examples: 'Ex.: comprovantes, declaração, orientação de cadastro.',
  };
}

export default function LiderChatPage() {
  const user = useAuth((s) => s.user);
  const isLgUp = useIsLgUp();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [showIntakeWizard, setShowIntakeWizard] = useState(false);
  const [showOtp, setShowOtp] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const meQuery = useQuery<LeaderMe>({
    queryKey: ['leader-portal', 'me'],
    queryFn: async () => await leaderPortalPageApi.fetchMe() as LeaderMe,
    enabled: user?.role === 'leader',
    refetchInterval: 10_000,
  });

  const statsQuery = useQuery<LeaderStats>({
    queryKey: ['leader-portal', 'stats', 'chat-context'],
    queryFn: async () => await leaderPortalPageApi.fetchStats() as LeaderStats,
    enabled: user?.role === 'leader',
  });

  const conversationsQuery = useQuery<ConversationRow[]>({
    queryKey: ['leader-chat', 'conversations'],
    queryFn: async () => (await inboxPageApi.listConversations()).data as ConversationRow[],
    enabled: user?.role === 'leader',
    refetchInterval: 10_000,
  });

  const conversationQuery = useQuery<ConversationDetail | null>({
    queryKey: ['leader-chat', 'conversation', selectedId],
    queryFn: async () => {
      if (!selectedId) return null;
      return await inboxPageApi.fetchConversation(selectedId) as ConversationDetail;
    },
    enabled: user?.role === 'leader' && Boolean(selectedId),
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [conversationQuery.data?.messages?.length]);

  const sendMutation = useMutation({
    mutationFn: async (text: string) => {
      await inboxPageApi.sendMessage({
        conversation_id: selectedId,
        type: 'text',
        content: text,
      });
    },
    onSuccess: async () => {
      setMessage('');
      await qc.invalidateQueries({ queryKey: ['leader-chat', 'conversation', selectedId] });
      await qc.invalidateQueries({ queryKey: ['leader-chat', 'conversations'] });
      await qc.invalidateQueries({ queryKey: ['leader-portal', 'me'] });
    },
  });

  const conversationRows = useMemo(() => {
    const rows = conversationsQuery.data || [];
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((c) => (c.sectors?.name || '').toLowerCase().includes(query) || c.id.toLowerCase().includes(query));
  }, [conversationsQuery.data, search]);

  const activeConversationTitle = useMemo(() => {
    const rows = conversationsQuery.data || [];
    const found = selectedId ? rows.find((c) => c.id === selectedId) : null;
    return found?.sectors?.name || 'Atendimento';
  }, [conversationsQuery.data, selectedId]);

  const activeSector = useMemo(() => {
    const detail = conversationQuery.data;
    if (detail?.sectors) return detail.sectors;
    const rows = conversationsQuery.data || [];
    const found = selectedId ? rows.find((c) => c.id === selectedId) : null;
    return found?.sectors || null;
  }, [conversationQuery.data, conversationsQuery.data, selectedId]);

  const bubbles = useMemo((): MessageBubbleModel[] => {
    const msgs = conversationQuery.data?.messages || [];
    return msgs.map((m, idx) => ({
      kind: 'message',
      id: m.id,
      direction: m.direction,
      type: m.type,
      content: m.content,
      media_url: m.media_url,
      created_at: m.created_at,
      status: m.status,
      grouped: idx > 0 && msgs[idx - 1]?.direction === m.direction,
    }));
  }, [conversationQuery.data?.messages]);

  if (user && user.role !== 'leader') {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <PageHeader eyebrow="Acesso" title="Chat com atendimento" description="Esta área é exclusiva para perfis de líder." compact />
        <Link className={buttonVariants({ variant: 'secondary' })} href="/dashboard">
          Voltar
        </Link>
      </div>
    );
  }

  const waConnected = meQuery.data?.whatsapp.connected ?? false;
  const waStatus = meQuery.data?.whatsapp.status || (waConnected ? 'verified' : 'unlinked');
  const waPhoneLabel = meQuery.data?.whatsapp.phone_e164 || meQuery.data?.leader.phone || null;

  const chatShellClass =
    'flex min-h-[min(520px,calc(100dvh-var(--leader-chrome)-10rem))] flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card lg:min-h-[520px] lg:h-[calc(100dvh-var(--leader-chrome)-12rem)]';

  const conversationsList = (
        <aside className="flex min-h-0 min-w-0 flex-1 flex-col border-border lg:flex-none lg:border-r">
          <div className="border-b border-border p-3">
            {!isLgUp ? (
              <Button
                type="button"
                onClick={() => setShowIntakeWizard(true)}
                disabled={waStatus !== 'verified'}
                className={cn('mb-3 w-full min-h-[44px] gap-1.5 shadow-glow', waStatus !== 'verified' && 'opacity-50')}
              >
                <Plus className="h-3.5 w-3.5" />
                Nova conversa
              </Button>
            ) : null}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <FormControl
                inputSize="sm"
                placeholder="Buscar conversa..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 py-2.5"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {conversationsQuery.isLoading ? (
              <div className="p-3 text-sm text-muted-foreground">Carregando…</div>
            ) : conversationRows.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">Nenhuma conversa.</div>
            ) : (
              conversationRows.map((c) => {
                const active = selectedId === c.id;
                const title = c.sectors?.name || 'Atendimento';
                const timeLabel = timeAgoLabel(c.last_message_at || c.created_at);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    className={cn(
                      'w-full rounded-lg border p-3 text-left transition-colors',
                      active
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-border bg-background/30 hover:border-primary/30 hover:bg-sidebar-accent/60'
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Headphones className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold">{title}</span>
                          <MessageCircle className="h-3.5 w-3.5 shrink-0 text-channel-whatsapp" />
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-2">
                          <span className="truncate text-[10px] text-muted-foreground">
                            {c.status === 'open' ? 'Em andamento' : 'Encerrado'}
                          </span>
                          {timeLabel ? <span className="shrink-0 font-mono text-[10px] text-subtle-foreground">{timeLabel}</span> : null}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>
  );

  const threadPanel = (
        <section className="flex min-h-0 flex-1 flex-col bg-background/20">
          {selectedId ? (
            <>
              <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-3 sm:px-4">
                <div className="flex min-w-0 items-center gap-2">
                  {!isLgUp ? (
                    <button
                      type="button"
                      onClick={() => setSelectedId(null)}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md hover:bg-sidebar-accent/60"
                      aria-label="Voltar para conversas"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                  ) : null}
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Headphones className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{activeConversationTitle}</div>
                    <div className="flex items-center gap-1 text-[10px] text-success">
                      <span className="h-1.5 w-1.5 rounded-full bg-success" /> WhatsApp
                    </div>
                  </div>
                </div>
                <button type="button" className="hidden rounded-md border border-border p-2 transition-colors hover:bg-sidebar-accent/60 sm:inline-flex">
                  <Phone className="h-4 w-4" />
                </button>
              </header>

              <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-4">
                <div className="mb-3 rounded-xl border border-border bg-background/40 p-3 text-xs">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">Contexto do atendimento</div>
                      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                        <div>
                          <span className="text-muted-foreground">Farmácia: </span>
                          <span className="font-medium text-foreground">
                            {conversationQuery.data?.context_pharmacy?.trade_name || '—'}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Entregador: </span>
                          <span className="font-medium text-foreground">
                            {conversationQuery.data?.context_driver?.name || '—'}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Setor: </span>
                          <span className="font-medium text-foreground">{activeSector?.name || activeConversationTitle}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Demanda: </span>
                          <span className="font-medium text-foreground">
                            {demandLabelFromConversation(conversationQuery.data)}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 text-muted-foreground">{sectorContext(activeSector?.name || activeConversationTitle).desc}</div>
                    </div>
                    <div className="text-right text-[10px] text-muted-foreground">
                      <div>{meQuery.data?.leader.name || 'Líder'}</div>
                      <div>{waStatus === 'verified' ? 'WhatsApp verificado' : 'WhatsApp pendente'}</div>
                    </div>
                  </div>
                  {conversationQuery.data?.summary ? (
                    <div className="mt-2 text-[11px] text-muted-foreground">{conversationQuery.data.summary}</div>
                  ) : null}
                </div>
                {conversationQuery.isLoading ? (
                  <div className="p-3 text-sm text-muted-foreground">Carregando conversa…</div>
                ) : (
                  bubbles.map((b) => <MessageBubble key={b.id} model={b} viewerRole="leader" />)
                )}
              </div>

              <footer className="safe-area-bottom border-t border-border bg-surface/40 p-3">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!message.trim() || !selectedId || waStatus !== 'verified') return;
                    sendMutation.mutate(message.trim());
                  }}
                  className="flex items-end gap-2"
                >
                  <button type="button" className="hidden rounded-md p-2 text-muted-foreground transition-colors hover:bg-sidebar-accent/60 sm:inline-flex" title="Emoji (em breve)">
                    <Smile className="h-4 w-4" />
                  </button>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={2}
                    placeholder="Mensagem..."
                    className={cn(formTextareaClassName, 'min-h-[44px] flex-1 resize-none')}
                    disabled={sendMutation.isPending || waStatus !== 'verified'}
                  />
                  <Button
                    type="submit"
                    disabled={!message.trim() || sendMutation.isPending || waStatus !== 'verified'}
                    className={cn('min-h-[44px] shrink-0 px-4', (sendMutation.isPending || waStatus !== 'verified') && 'opacity-50')}
                  >
                    Enviar
                  </Button>
                </form>
              </footer>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
              <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-background/40 text-muted-foreground">
                <Headphones size={40} className="opacity-20" />
              </div>
              <h3 className="mb-2 text-lg font-bold">Suporte Direto</h3>
              <p className="mx-auto max-w-xs text-sm text-muted-foreground">
                Selecione uma conversa ou use Nova conversa no painel à esquerda (desktop) ou no topo da lista (celular).
              </p>
            </div>
          )}
        </section>
  );

  const intakePanel = (
        <aside className="hidden space-y-4 border-r border-border bg-background/30 p-4 lg:flex lg:flex-col">
          <div>
            <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Novo atendimento</h4>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Farmácia → entregador (opcional) → setor → demanda configurada no canal.
            </p>
          </div>
          <Button
            type="button"
            disabled={waStatus !== 'verified'}
            onClick={() => setShowIntakeWizard(true)}
            className={cn('w-full min-h-[44px] gap-1.5 shadow-glow', waStatus !== 'verified' && 'opacity-50')}
          >
            <Plus className="h-3.5 w-3.5" />
            Nova conversa
          </Button>
          <div className="space-y-2 border-t border-border pt-2 text-[11px]">
            <div className="flex justify-between text-muted-foreground">
              <span>Farmácias na rede:</span>
              <span className="text-foreground">{statsQuery.data?.pharmacies_count ?? '—'}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Entregadores:</span>
              <span className="text-foreground">{statsQuery.data?.drivers_count ?? '—'}</span>
            </div>
          </div>
        </aside>
  );

  return (
    <LeaderPage fullHeight className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        icon={MessageCircle}
        eyebrow="Suporte"
        title="Chat com atendimento"
        description="Conectado via WhatsApp · triagem guiada com farmácia, entregador e demanda."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <LeaderWhatsAppStatusButton status={waStatus} phone={waPhoneLabel} onClick={() => setShowOtp(true)} />
            <Button
              type="button"
              size="xs"
              disabled={waStatus !== 'verified'}
              onClick={() => setShowIntakeWizard(true)}
              className={cn('gap-1.5 shadow-glow', waStatus !== 'verified' && 'opacity-50')}
            >
              <Plus className="h-3.5 w-3.5" />
              Nova conversa
            </Button>
          </div>
        }
      />

      <div className={cn('min-h-0 flex-1', chatShellClass)}>
        <div className="flex min-h-0 flex-1 flex-col lg:hidden">
          {!selectedId ? conversationsList : threadPanel}
        </div>

        <div className="hidden min-h-0 flex-1 lg:grid lg:grid-cols-[260px_320px_1fr]">
        {intakePanel}
        {conversationsList}
        {threadPanel}
        </div>
      </div>

      <LeaderIntakeWizard
        open={showIntakeWizard}
        verified={waStatus === 'verified'}
        onClose={() => setShowIntakeWizard(false)}
        onStarted={async (id) => {
          await qc.invalidateQueries({ queryKey: ['leader-chat', 'conversations'] });
          setSelectedId(id);
        }}
      />

      <LeaderWhatsAppOtpModal
        open={showOtp}
        status={waStatus}
        initialPhone={waPhoneLabel}
        onClose={() => setShowOtp(false)}
        onDone={() => void meQuery.refetch()}
      />
    </LeaderPage>
  );
}
