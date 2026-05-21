'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DollarSign, Headphones, Phone, Search, ShieldCheck, Smile, Wrench } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { ConversationItem, type ConversationItemModel } from '@/components/ui/ConversationItem';
import { MessageBubble, type MessageBubbleModel } from '@/components/ui/MessageBubble';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';
import { LeaderWhatsAppOtpModal } from '@/components/leader/LeaderWhatsAppOtpModal';
import { LeaderWhatsAppStatusButton, type LeaderWhatsAppStatus } from '@/components/leader/LeaderWhatsAppStatusButton';

type Sector = { id: string; name: string; is_active?: boolean | null };

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

type ConversationDetail = {
  id: string;
  summary?: string | null;
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

function sectorIcon(name: string) {
  const n = name.toLowerCase();
  if (n.includes('fin')) return DollarSign;
  if (n.includes('suporte') || n.includes('tec')) return Wrench;
  if (n.includes('opera') || n.includes('rh')) return ShieldCheck;
  return Headphones;
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
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [showSectorModal, setShowSectorModal] = useState(false);
  const [showOtp, setShowOtp] = useState(false);
  const [selectedSectorId, setSelectedSectorId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const meQuery = useQuery<LeaderMe>({
    queryKey: ['leader-portal', 'me'],
    queryFn: async () => (await api.get('/api/leader-portal/me')).data as LeaderMe,
    enabled: user?.role === 'leader',
    refetchInterval: 10_000,
  });

  const sectorsQuery = useQuery<Sector[]>({
    queryKey: ['sectors'],
    queryFn: async () => (await api.get('/api/sectors')).data as Sector[],
    enabled: user?.role === 'leader',
  });

  const statsQuery = useQuery<LeaderStats>({
    queryKey: ['leader-portal', 'stats', 'chat-context'],
    queryFn: async () => (await api.get('/api/leader-portal/stats')).data as LeaderStats,
    enabled: user?.role === 'leader',
  });

  const conversationsQuery = useQuery<ConversationRow[]>({
    queryKey: ['leader-chat', 'conversations'],
    queryFn: async () => (await api.get('/api/conversations')).data.data as ConversationRow[],
    enabled: user?.role === 'leader',
    refetchInterval: 10_000,
  });

  const conversationQuery = useQuery<ConversationDetail | null>({
    queryKey: ['leader-chat', 'conversation', selectedId],
    queryFn: async () => {
      if (!selectedId) return null;
      return (await api.get(`/api/conversations/${selectedId}`)).data as ConversationDetail;
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
      await api.post('/api/messages/send', {
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

  const createMutation = useMutation({
    mutationFn: async (sector_id: string) => {
      const res = await api.post('/api/conversations/start', { sector_id });
      return res.data as { id: string };
    },
    onSuccess: async (row) => {
      await qc.invalidateQueries({ queryKey: ['leader-chat', 'conversations'] });
      setSelectedId(row.id);
      setShowSectorModal(false);
    },
  });

  const sectors = useMemo(() => (sectorsQuery.data || []).filter((s) => s.is_active !== false), [sectorsQuery.data]);

  const items = useMemo((): ConversationItemModel[] => {
    const rows = conversationsQuery.data || [];
    const query = search.trim().toLowerCase();
    const filtered = !query
      ? rows
      : rows.filter((c) => (c.sectors?.name || '').toLowerCase().includes(query) || c.id.toLowerCase().includes(query));
    return filtered.map((c) => ({
      id: c.id,
      title: c.sectors?.name ? c.sectors.name : `Conversa #${c.id.slice(0, 8)}`,
      subtitle: `#${c.id.slice(0, 8)}`,
      preview: null,
      updatedLabel: timeAgoLabel(c.last_message_at || c.created_at),
      unread: false,
      contextLabel: 'Portal do líder',
      ownerLabel: c.status === 'open' ? 'Ativo' : 'Encerrado',
      channel: 'whatsapp',
      sla: null,
      avatar: <Headphones size={16} />,
    }));
  }, [conversationsQuery.data, search]);

  const activeConversationTitle = useMemo(() => {
    const rows = conversationsQuery.data || [];
    const found = selectedId ? rows.find((c) => c.id === selectedId) : null;
    return found?.sectors?.name || 'Atendimento';
  }, [conversationsQuery.data, selectedId]);

  const activeSector = useMemo(() => {
    const rows = conversationsQuery.data || [];
    const found = selectedId ? rows.find((c) => c.id === selectedId) : null;
    return found?.sectors || null;
  }, [conversationsQuery.data, selectedId]);

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
        <Link className="button-secondary" href="/dashboard">
          Voltar
        </Link>
      </div>
    );
  }

  const waConnected = meQuery.data?.whatsapp.connected ?? false;
  const waStatus = meQuery.data?.whatsapp.status || (waConnected ? 'verified' : 'unlinked');
  const waPhoneLabel = meQuery.data?.whatsapp.phone_e164 || meQuery.data?.leader.phone || null;

  return (
    <div className="p-8 max-w-7xl">
      <PageHeader
        eyebrow="Suporte"
        title="Chat com atendimento"
        description="Conectado via WhatsApp · escolha o setor para abrir uma nova conversa."
        actions={
          <div className="flex items-center gap-2">
            <LeaderWhatsAppStatusButton status={waStatus} phone={waPhoneLabel} onClick={() => setShowOtp(true)} />
            <button
              type="button"
              onClick={() => setShowSectorModal(true)}
              disabled={waStatus !== 'verified'}
              className={cn('button-primary', waStatus !== 'verified' && 'opacity-50')}
            >
              Nova conversa
            </button>
          </div>
        }
      />

      <div className="grid lg:grid-cols-[260px_320px_1fr] gap-0 rounded-xl border border-border bg-card overflow-hidden h-[calc(100vh-260px)] min-h-[520px]">
        {/* Setores */}
        <aside className="border-r border-border bg-background/30">
          <div className="border-b border-border p-3">
            <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground">Abrir nova conversa</h4>
          </div>
          <ul className="p-2 space-y-1 overflow-y-auto">
            {sectors.map((s) => {
              const Icon = sectorIcon(s.name);
              const active = selectedSectorId === s.id;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedSectorId(s.id)}
                    className={cn('w-full flex items-center gap-2.5 rounded-md p-2 text-left hover:bg-surface-hover', active && 'bg-surface-hover')}
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{s.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{sectorContext(s.name).desc}</div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Conversas */}
        <aside className="border-r border-border">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                placeholder="Buscar conversa..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-border bg-background/40 pl-8 pr-3 py-2 text-xs focus:outline-none focus:border-primary/50"
              />
            </div>
          </div>
          <div className="p-2 space-y-2 overflow-y-auto h-full">
            {conversationsQuery.isLoading ? (
              <div className="p-3 text-sm text-muted-foreground">Carregando…</div>
            ) : items.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">Nenhuma conversa.</div>
            ) : (
              items.map((item) => (
                <ConversationItem key={item.id} item={item} active={selectedId === item.id} onSelect={() => setSelectedId(item.id)} />
              ))
            )}
          </div>
        </aside>

        {/* Conversa */}
        <section className="flex flex-col bg-background/20">
          {selectedId ? (
            <>
              <header className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-channel-whatsapp/15 text-channel-whatsapp">
                    <Headphones className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">{activeConversationTitle}</div>
                    <div className="text-[10px] text-success flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-success" /> WhatsApp
                    </div>
                  </div>
                </div>
                <button type="button" className="rounded-md border border-border p-2 hover:bg-surface-hover">
                  <Phone className="h-4 w-4" />
                </button>
              </header>

              <div ref={scrollRef} className="flex-1 overflow-auto px-4 py-3">
                <div className="mb-3 rounded-xl border border-border bg-surface/70 p-3 text-xs">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">Contexto do atendimento</div>
                      <div className="mt-1 text-muted-foreground">
                        Setor: <span className="font-medium text-foreground">{activeSector?.name || activeConversationTitle}</span>
                      </div>
                      <div className="mt-1 text-muted-foreground">{sectorContext(activeSector?.name || activeConversationTitle).desc}</div>
                    </div>
                    <div className="text-right text-[10px] text-muted-foreground">
                      <div>{meQuery.data?.leader.name || 'Líder'}</div>
                      <div>{waStatus === 'verified' ? 'WhatsApp verificado' : 'WhatsApp pendente'}</div>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-lg bg-background/60 px-3 py-2">
                      <div className="text-[10px] text-muted-foreground">Farmácias na rede</div>
                      <div className="font-semibold">{statsQuery.data?.pharmacies_count ?? '—'}</div>
                    </div>
                    <div className="rounded-lg bg-background/60 px-3 py-2">
                      <div className="text-[10px] text-muted-foreground">Entregadores</div>
                      <div className="font-semibold">{statsQuery.data?.drivers_count ?? '—'}</div>
                    </div>
                    <div className="rounded-lg bg-background/60 px-3 py-2">
                      <div className="text-[10px] text-muted-foreground">Pendências</div>
                      <div className="font-semibold">
                        {(statsQuery.data?.pending_absences ?? 0) + (statsQuery.data?.pending_dailies ?? 0)}
                      </div>
                    </div>
                  </div>
                  {conversationQuery.data?.summary ? (
                    <div className="mt-2 text-[11px] text-muted-foreground">{conversationQuery.data.summary}</div>
                  ) : null}
                </div>
                {conversationQuery.isLoading ? <div className="p-3 text-sm text-muted-foreground">Carregando conversa…</div> : bubbles.map((b) => <MessageBubble key={b.id} model={b} />)}
              </div>

              <footer className="border-t border-border p-3">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!message.trim() || !selectedId || waStatus !== 'verified') return;
                    sendMutation.mutate(message.trim());
                  }}
                  className="flex items-end gap-2"
                >
                  <button type="button" className="rounded-md p-2 text-muted-foreground hover:bg-surface-hover" title="Emoji (em breve)">
                    <Smile className="h-4 w-4" />
                  </button>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={1}
                    placeholder="Mensagem..."
                    className="flex-1 resize-none rounded-lg border border-border bg-background/40 px-3 py-2 text-sm focus:outline-none focus:border-primary/50"
                    disabled={sendMutation.isPending || waStatus !== 'verified'}
                  />
                  <button
                    type="submit"
                    disabled={!message.trim() || sendMutation.isPending || waStatus !== 'verified'}
                    className={cn('button-primary', (sendMutation.isPending || waStatus !== 'verified') && 'opacity-50')}
                  >
                    Enviar
                  </button>
                </form>
              </footer>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="h-20 w-20 rounded-3xl bg-surface-2 flex items-center justify-center text-muted-foreground mb-4">
                <Headphones size={40} className="opacity-20" />
              </div>
              <h3 className="text-lg font-bold mb-2">Suporte Direto</h3>
              <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                Selecione uma conversa ao lado ou inicie um novo chamado para falar com nossa equipe.
              </p>
            </div>
          )}
        </section>
      </div>

      {showSectorModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface w-full max-w-md rounded-2xl shadow-2xl border border-border overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-border">
              <h3 className="text-xl font-bold">Iniciar Atendimento</h3>
              <p className="text-sm text-muted-foreground mt-1">Com qual setor você deseja falar?</p>
            </div>
            <div className="p-4 grid gap-2">
              {sectors.map((s) => (
                <button
                  key={s.id}
                  onClick={() => createMutation.mutate(s.id)}
                  disabled={createMutation.isPending || waStatus !== 'verified'}
                  className="flex items-center justify-between p-4 rounded-xl border border-border bg-surface-2 hover:bg-primary/5 hover:border-primary/40 transition-all text-left"
                >
                  <span>
                    <span className="block font-semibold">{s.name}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{sectorContext(s.name).examples}</span>
                  </span>
                  <span className="text-muted-foreground">→</span>
                </button>
              ))}
            </div>
            <div className="p-4 bg-surface-2 border-t border-border">
              <button type="button" onClick={() => setShowSectorModal(false)} className="w-full button-secondary">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <LeaderWhatsAppOtpModal
        open={showOtp}
        status={waStatus}
        initialPhone={waPhoneLabel}
        onClose={() => setShowOtp(false)}
        onDone={() => void meQuery.refetch()}
      />
    </div>
  );
}
