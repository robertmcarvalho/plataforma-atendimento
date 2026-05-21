'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ExternalAppLink } from '@/components/navigation/ExternalAppLink';
import {
  ArrowRight,
  CheckSquare,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  FileText,
  IdCard,
  ListChecks,
  Loader2,
  Mail,
  MessageSquare,
  MessagesSquare,
  Phone,
  RefreshCw,
  Send,
  Sparkles,
  Tag,
  ThumbsDown,
  ThumbsUp,
  User,
  Wand2,
  X,
} from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { useMergedAiFeatures } from '@/lib/ai/useAiFeatures';
import { CopilotAssistantMarkdown } from '@/components/copilot/CopilotAssistantMarkdown';

type ChatMsg = { role: 'user' | 'assistant'; content: string };
type TabKey = 'briefing' | 'steps' | 'reply' | 'chat';

type CopilotChatResponse = {
  reply: string;
  model?: string;
  sources?: { has_conversation_context?: boolean; entity_keys?: string[] };
};

type CopilotBriefing = {
  summary: string;
  signals?: Array<{ label: string; value: string; tone?: 'default' | 'primary' | 'warning' | 'danger' }>;
  operational_context?: string[];
  contact_sheet?: {
    name?: string;
    profile?: string;
    phone?: string;
    email?: string;
    city?: string;
    document?: string;
    client_since?: string;
    entity_type?: string;
    entity_id?: string;
    href?: string;
  };
  timeline: Array<{ date: string; title: string; summary: string; source: string }>;
  next_steps: Array<{ type: 'Verificar' | 'Perguntar' | 'Consultar' | 'Escalar' | 'Responder'; text: string }>;
  draft_reply: string;
  reply_variants?: Array<{ tone: string; text: string }>;
  warnings: string[];
  model?: string;
  sources?: { has_conversation_context?: boolean; event_count?: number; entity_keys?: string[] };
};

type ReplyTone = 'Empática' | 'Direta' | 'Formal';

const tabs: Array<{ id: TabKey; label: string; icon: typeof FileText }> = [
  { id: 'briefing', label: 'Briefing', icon: FileText },
  { id: 'steps', label: 'Passos', icon: ListChecks },
  { id: 'reply', label: 'Resposta', icon: MessageSquare },
  { id: 'chat', label: 'Chat', icon: MessagesSquare },
];

function storageKey(conversationId: string | null) {
  return `copilot-msgs-${conversationId || 'global'}`;
}

function loadStored(key: string): ChatMsg[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m): m is ChatMsg => m && typeof m === 'object' && (m as ChatMsg).role && typeof (m as ChatMsg).content === 'string')
      .slice(-40);
  } catch {
    return [];
  }
}

function saveStored(key: string, msgs: ChatMsg[]) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(msgs.slice(-40)));
  } catch {
    /* ignore */
  }
}

function parseJsonish(value: string): Record<string, unknown> | null {
  const text = String(value || '').trim();
  if (!text.includes('{')) return null;
  try {
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function humanizeTechnicalText(value: string, fallback = 'Registro operacional disponível para análise.'): string {
  const text = String(value || '').trim();
  if (!text) return fallback;
  if (!/"\w+"\s*:|orchestrator_inbound|message_id|classification|\{|\}/i.test(text)) return text;
  const parsed = parseJsonish(text);
  const classification = parsed?.classification && typeof parsed.classification === 'object' ? (parsed.classification as Record<string, unknown>) : {};
  const typeMap: Record<string, string> = {
    advance: 'adiantamento',
    question: 'dúvida',
    document: 'documentação',
    delivery: 'operação/entrega',
  };
  const type = typeMap[String(classification.type || parsed?.type || '').toLowerCase()] || 'atendimento';
  const priority = String(classification.priority || parsed?.priority || 'normal');
  const sla = classification.sla_minutes ? ` com SLA de ${classification.sla_minutes} min` : '';
  return `Registro operacional classificado como ${type}, prioridade ${priority}${sla}.`;
}

function displayText(value: unknown, fallback?: string) {
  return humanizeTechnicalText(String(value || ''), fallback);
}

const quickPrompts = ['Resumir', 'Sugerir resposta', 'Dados para cadastro', 'Verificar fluxo'];

export function CopilotPanel(props: {
  open: boolean;
  onClose: () => void;
  conversationId: string | null;
  onOpenContext?: () => void;
  onInsertToComposer: (text: string) => void;
}) {
  const { open, onClose, conversationId, onOpenContext, onInsertToComposer } = props;
  const key = useMemo(() => storageKey(conversationId), [conversationId]);

  const [chatState, setChatState] = useState<{ key: string; messages: ChatMsg[] }>(() => ({ key, messages: loadStored(key) }));
  const [draft, setDraft] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('briefing');
  const [replyInstruction, setReplyInstruction] = useState('');
  const [draftSyncInstruction, setDraftSyncInstruction] = useState<string | undefined>(undefined);
  const [selectedReplyTone, setSelectedReplyTone] = useState<ReplyTone>('Empática');
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const aiRuntime = useMergedAiFeatures();
  const briefingEnabled = aiRuntime.inbound_assist;

  if (chatState.key !== key) {
    setChatState({ key, messages: loadStored(key) });
  }

  const messages = chatState.key === key ? chatState.messages : loadStored(key);

  const appendMessages = useCallback(
    (updater: (prev: ChatMsg[]) => ChatMsg[]) => {
      setChatState((prev) => {
        const base = prev.key === key ? prev.messages : loadStored(key);
        const next = updater(base);
        saveStored(key, next);
        return { key, messages: next };
      });
    },
    [key]
  );

  const chatMut = useMutation({
    mutationFn: async (message: string) => {
      const { data } = await api.post<CopilotChatResponse>('/api/copilot/chat', {
        message,
        conversation_id: conversationId || undefined,
      });
      return data;
    },
  });

  useEffect(() => {
    setDraftSyncInstruction(undefined);
    setReplyInstruction('');
  }, [conversationId]);

  const briefingQuery = useQuery({
    queryKey: ['copilot-briefing', conversationId, selectedReplyTone, draftSyncInstruction],
    enabled: open && Boolean(conversationId) && briefingEnabled,
    retry: false,
    queryFn: async () => {
      const { data } = await api.post<CopilotBriefing>('/api/copilot/briefing', {
        conversation_id: conversationId,
        response_tone: selectedReplyTone,
        ...(draftSyncInstruction ? { instruction: draftSyncInstruction.slice(0, 1000) } : {}),
      });
      return data;
    },
  });

  const send = useCallback(async () => {
    const msg = draft.trim();
    if (!msg || chatMut.isPending) return;
    try {
      const data = await chatMut.mutateAsync(msg);
      appendMessages((prev) => [...prev, { role: 'user', content: msg }, { role: 'assistant', content: data.reply || '' }]);
      setDraft('');
    } catch {
      /* erro exibido via chatMut */
    }
  }, [appendMessages, chatMut, draft]);

  useLayoutEffect(() => {
    if (activeTab !== 'chat') return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [activeTab, messages, chatMut.isPending]);

  if (!open) return null;

  const briefing = briefingQuery.data;
  const briefingError =
    (briefingQuery.error as { response?: { data?: { error?: string } } } | null)?.response?.data?.error ||
    (briefingQuery.error instanceof Error ? briefingQuery.error.message : '');

  if (collapsed) {
    return (
      <div className="fixed inset-y-0 right-0 z-[60] flex w-12 flex-col items-center gap-1 border-l border-border bg-surface py-2">
        <button type="button" onClick={() => setCollapsed(false)} className="rounded-md p-2 text-primary hover:bg-surface-hover" title="Expandir Copiloto">
          <ChevronsLeft className="h-4 w-4" />
        </button>
        <div className="mt-1 flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        {[
          { icon: FileText, id: 'briefing' as const, title: 'Briefing' },
          { icon: ListChecks, id: 'steps' as const, title: 'Próximos passos' },
          { icon: MessageSquare, id: 'reply' as const, title: 'Resposta' },
          { icon: MessagesSquare, id: 'chat' as const, title: 'Chat' },
        ].map(({ icon: Icon, id, title }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setActiveTab(id);
              setCollapsed(false);
            }}
            className="rounded-md p-2 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            title={title}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
        <button type="button" onClick={onClose} className="mt-auto rounded-md p-2 text-muted-foreground hover:bg-surface-hover hover:text-foreground" title="Fechar">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-y-0 right-0 z-[60] flex w-full max-w-[29rem] flex-col border-l border-[#24242a] bg-[#09090b] text-white shadow-2xl" role="dialog" aria-label="Copiloto interno">
      <div className="flex h-[61px] shrink-0 items-center justify-between border-b border-[#24242a] px-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0f1b33] text-[#3b82f6]">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <div className="text-base font-semibold tracking-tight text-white">Copiloto</div>
              <span className="rounded border border-[#2563eb]/60 bg-[#0b1733] px-1.5 py-0.5 text-[10px] font-medium text-[#60a5fa]">IA</span>
            </div>
            <div className="text-xs text-[#a1a1aa]">
              {briefing?.contact_sheet?.name
                ? `${briefing.contact_sheet.name}${briefing.contact_sheet.profile ? ` · ${briefing.contact_sheet.profile}` : ''}`
                : conversationId ? 'Briefing operacional da conversa aberta' : 'Selecione uma conversa para gerar briefing'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-[#71717a] hover:bg-[#18181b] hover:text-white" title="Recolher">
            <ChevronsRight className="h-4 w-4" />
          </button>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-[#71717a] hover:bg-[#18181b] hover:text-white" title="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <SignalBadges briefing={briefing} />

      <div className="border-b border-[#24242a] px-3 py-3">
        <div className="grid grid-cols-4 gap-1 rounded-xl border border-[#27272a] bg-[#09090b] p-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors',
                activeTab === tab.id ? 'bg-[#0f1b33] text-[#3b82f6]' : 'text-[#a1a1aa] hover:bg-[#18181b] hover:text-white'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
            );
          })}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {activeTab === 'briefing' ? (
          <BriefingTab
            briefing={briefing}
            isLoading={briefingQuery.isLoading}
            error={!briefingEnabled ? 'Briefing automático do Copiloto desativado nas configurações de IA.' : briefingError}
            onOpenContext={onOpenContext}
          />
        ) : activeTab === 'steps' ? (
          <StepsTab briefing={briefing} />
        ) : activeTab === 'reply' ? (
          <ReplyTab
            conversationId={conversationId}
            briefing={briefing}
            isFetching={briefingQuery.isFetching}
            assistQuestion={replyInstruction}
            setAssistQuestion={setReplyInstruction}
            selectedReplyTone={selectedReplyTone}
            setSelectedReplyTone={setSelectedReplyTone}
            onRegenerateDraft={() => {
              void briefingQuery.refetch();
            }}
            onAssistComplete={(assistReply, question) => {
              const q = question.toLowerCase();
              const isRegistrationAssist =
                /ficha|cadastro|faltam|dados|entregador|lacuna|pré-cadastro|pre-cadastro|solicitar/i.test(q) ||
                /estado|cidade|obrigatório|obrigatorio|faltam/i.test(assistReply.toLowerCase());
              if (!isRegistrationAssist) return;
              setDraftSyncInstruction(
                `Redija mensagem WhatsApp ao cliente pedindo SOMENTE os dados obrigatórios em falta identificados na análise abaixo. Não peça CPF/CNPJ nem farmácia se não estiverem na lista de obrigatórios em falta.\n\n${assistReply.slice(0, 850)}`
              );
            }}
            onInsertToComposer={onInsertToComposer}
          />
        ) : (
          <ChatTab
            messages={messages}
            chatMut={chatMut}
            draft={draft}
            setDraft={setDraft}
            onSend={() => void send()}
            onInsertToComposer={onInsertToComposer}
          />
        )}
      </div>
    </div>
  );
}

function SignalBadges({ briefing }: { briefing?: CopilotBriefing }) {
  const raw = briefing?.signals || [];
  const byLabel = (label: string) => raw.find((signal) => signal.label.toLowerCase().includes(label));
  const candidates = [
    { label: 'SENTIMENTO', value: byLabel('sentimento')?.value, className: 'border-[#a16207] bg-[#422006]/70 text-[#facc15]' },
    { label: 'URGÊNCIA', value: byLabel('urgência')?.value, className: 'border-[#7f1d1d] bg-[#2a0d0d] text-[#f87171]' },
    { label: 'INTENÇÃO', value: byLabel('intenção')?.value, className: 'border-[#1d4ed8] bg-[#0b1733] text-[#60a5fa]' },
    { label: 'CHURN', value: byLabel('churn')?.value, className: 'border-[#a16207] bg-[#422006]/70 text-[#facc15]' },
  ];
  const badges = candidates.filter((badge): badge is { label: string; value: string; className: string } => Boolean(badge.value));
  return (
    <div className="flex flex-wrap gap-1.5 border-b border-[#24242a] px-4 py-2">
      {badges.length ? (
        badges.map((badge) => (
          <span key={badge.label} className={cn('rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-4', badge.className)}>
            <span className="font-mono uppercase tracking-wide opacity-80">{badge.label}</span>
            <span className="mx-1">›</span>
            <span>{displayText(badge.value)}</span>
          </span>
        ))
      ) : (
        <span className="rounded border border-[#27272a] bg-[#18181b] px-2 py-1 text-[10px] font-semibold text-[#a1a1aa]">Sem contexto</span>
      )}
    </div>
  );
}

function BriefingTab({
  briefing,
  isLoading,
  error,
  onOpenContext,
}: {
  briefing?: CopilotBriefing;
  isLoading: boolean;
  error: string;
  onOpenContext?: () => void;
}) {
  return (
    <div className="space-y-3">
      {isLoading ? (
        <div className="rounded-xl border border-[#27272a] bg-[#18181b] p-3 text-xs text-[#a1a1aa]">
          <Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />
          Gerando briefing do atendimento...
        </div>
      ) : null}
      {error ? <div className="rounded-xl border border-[#a16207] bg-[#422006]/50 p-3 text-xs text-[#facc15]">{error}</div> : null}

      <section className="rounded-xl border border-[#27272a] bg-[#18181b] p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-white">
            <FileText className="h-4 w-4 text-[#3b82f6]" />
            RESUMO
          </div>
        </div>
        <p className="text-sm font-medium leading-relaxed text-white">{displayText(briefing?.summary, 'Sem resumo operacional gerado ainda.')}</p>
      </section>

      <section className="rounded-xl border border-[#27272a] bg-[#18181b] p-4">
        <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[#71717a]">
          <Tag className="h-3.5 w-3.5 text-[#3b82f6]" />
          Contexto operacional
        </div>
        <ul className="space-y-1.5 text-sm font-medium text-white">
          {(briefing?.operational_context || []).length ? (
            briefing!.operational_context!.slice(0, 6).map((item) => (
              <li key={item} className="flex items-start gap-1.5">
                <ArrowRight className="mt-1 h-3 w-3 shrink-0 text-[#3b82f6]" />
                <span>{displayText(item)}</span>
              </li>
            ))
          ) : (
            <li>Sem contexto operacional condensado.</li>
          )}
        </ul>
      </section>

      {briefing?.contact_sheet ? (
        <section className="rounded-xl border border-[#27272a] bg-[#18181b] p-4">
          <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[#71717a]">
            <User className="h-3.5 w-3.5 text-[#71717a]" />
            Ficha
          </div>
          <div className="space-y-2 text-sm text-white">
            {briefing.contact_sheet.phone ? (
              <div className="flex items-center gap-2">
                <Phone className="h-3.5 w-3.5 text-[#a1a1aa]" />
                {briefing.contact_sheet.phone}
              </div>
            ) : null}
            {briefing.contact_sheet.document ? (
              <div className="flex items-center gap-2">
                <IdCard className="h-3.5 w-3.5 text-[#a1a1aa]" />
                {briefing.contact_sheet.document}
              </div>
            ) : null}
            {briefing.contact_sheet.email ? (
              <div className="flex items-center gap-2">
                <Mail className="h-3.5 w-3.5 shrink-0 text-[#a1a1aa]" />
                <span>{briefing.contact_sheet.email}</span>
              </div>
            ) : null}
            {briefing.contact_sheet.client_since ? (
              <div className="text-xs text-[#a1a1aa]">{briefing.contact_sheet.client_since}</div>
            ) : null}
          </div>
          {briefing.contact_sheet.href ? (
            <div className="mt-3 border-t border-[#27272a] pt-3">
              <ExternalAppLink
                href={briefing.contact_sheet.href}
                showIcon
                className="flex w-full items-center justify-center rounded-lg border border-[#27272a] bg-[#09090b] px-3 py-2 text-xs font-medium text-white hover:bg-[#111113]"
                title="Abrir ficha completa (nova aba)"
              >
                Abrir ficha completa
              </ExternalAppLink>
            </div>
          ) : onOpenContext ? (
            <div className="mt-3 border-t border-[#27272a] pt-3">
              <button
                type="button"
                onClick={onOpenContext}
                className="flex w-full items-center justify-center rounded-lg border border-[#27272a] bg-[#09090b] px-3 py-2 text-xs font-medium text-white hover:bg-[#111113]"
              >
                Abrir contexto completo
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function StepsTab({ briefing }: { briefing?: CopilotBriefing }) {
  return (
    <div className="space-y-2">
      {(briefing?.next_steps || []).length ? (
        briefing!.next_steps.map((step, idx) => (
          <div key={`${step.type}-${idx}`} className="rounded-xl border border-border bg-surface-elevated p-3">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <CheckSquare className="h-3.5 w-3.5" />
              {step.type}
            </div>
            <p className="text-xs leading-relaxed text-foreground">{step.text}</p>
          </div>
        ))
      ) : (
        <p className="rounded-xl border border-border bg-surface-elevated p-3 text-xs text-muted-foreground">Nenhum próximo passo sugerido ainda.</p>
      )}
    </div>
  );
}

function ReplyTab({
  conversationId,
  briefing,
  isFetching,
  assistQuestion,
  setAssistQuestion,
  selectedReplyTone,
  setSelectedReplyTone,
  onRegenerateDraft,
  onAssistComplete,
  onInsertToComposer,
}: {
  conversationId: string | null;
  briefing?: CopilotBriefing;
  isFetching: boolean;
  assistQuestion: string;
  setAssistQuestion: (value: string) => void;
  selectedReplyTone: ReplyTone;
  setSelectedReplyTone: (value: ReplyTone) => void;
  onRegenerateDraft: () => void;
  onAssistComplete: (assistReply: string, question: string) => void;
  onInsertToComposer: (text: string) => void;
}) {
  const [editableReply, setEditableReply] = useState('');
  const [assistReply, setAssistReply] = useState('');
  const tones: ReplyTone[] = ['Empática', 'Direta', 'Formal'];

  const assistMut = useMutation({
    mutationFn: async (message: string) => {
      const { data } = await api.post<CopilotChatResponse>('/api/copilot/assist', {
        message,
        conversation_id: conversationId,
      });
      return data;
    },
  });

  useEffect(() => {
    setEditableReply(briefing?.draft_reply || '');
  }, [briefing?.draft_reply]);

  const runAssist = () => {
    const q = assistQuestion.trim();
    if (!q || !conversationId || assistMut.isPending) return;
    void assistMut.mutateAsync(q).then((data) => {
      const reply = data.reply || '';
      setAssistReply(reply);
      if (reply) onAssistComplete(reply, q);
    });
  };

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-[#27272a] bg-[#18181b] p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#71717a]">
          Orientação interna
        </div>
        <textarea
          value={assistQuestion}
          onChange={(e) => setAssistQuestion(e.target.value)}
          rows={3}
          placeholder="Ex.: verifique a ficha do entregador e diga quais dados ainda faltam para finalizar o cadastro."
          className="w-full resize-none rounded-lg border border-[#27272a] bg-[#09090b] px-3 py-2 text-xs text-white outline-none placeholder:text-[#71717a] focus:border-[#2563eb]"
        />
        <button
          type="button"
          disabled={!assistQuestion.trim() || !conversationId || assistMut.isPending}
          onClick={runAssist}
          className="mt-2 inline-flex items-center gap-2 rounded-lg border border-[#27272a] bg-[#09090b] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#111113] disabled:opacity-50"
        >
          {assistMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Consultar copiloto
        </button>
        {assistReply ? (
          <div className="mt-3 rounded-lg border border-[#27272a] bg-[#09090b] p-3 text-xs text-[#e4e4e7]">
            <CopilotAssistantMarkdown content={assistReply} />
          </div>
        ) : null}
        {assistMut.isError ? (
          <p className="mt-2 text-xs text-red-400">
            {(assistMut.error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
              'Falha na consulta.'}
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-[#27272a] bg-[#18181b] p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[#71717a]">
            <Wand2 className="h-3.5 w-3.5 text-[#3b82f6]" />
            Rascunho para o cliente
          </div>
          <div className="flex flex-wrap gap-1">
            {tones.map((tone) => (
              <button
                key={tone}
                type="button"
                onClick={() => setSelectedReplyTone(tone)}
                disabled={isFetching && selectedReplyTone === tone}
                className={cn(
                  'rounded border px-2 py-1 text-[10px] font-medium',
                  selectedReplyTone === tone ? 'border-[#2563eb] bg-[#0b1733] text-[#60a5fa]' : 'border-[#27272a] text-[#a1a1aa] hover:bg-[#111113] hover:text-white'
                )}
              >
                {tone}
              </button>
            ))}
          </div>
        </div>
        <textarea
          value={editableReply}
          onChange={(e) => setEditableReply(e.target.value)}
          rows={8}
          placeholder="Gere ou edite o rascunho antes de inserir no composer."
          className="w-full resize-none rounded-lg border border-[#27272a] bg-[#09090b] px-3 py-3 text-sm font-semibold leading-relaxed text-white outline-none placeholder:text-[#71717a] focus:border-[#2563eb]"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!editableReply.trim()}
            onClick={() => editableReply.trim() && onInsertToComposer(editableReply.trim())}
            className="inline-flex items-center gap-2 rounded-lg bg-[#2563eb] px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            Enviar
          </button>
          <button
            type="button"
            disabled={!editableReply.trim()}
            onClick={() => editableReply.trim() && navigator.clipboard?.writeText(editableReply.trim())}
            className="inline-flex items-center gap-2 rounded-lg border border-[#27272a] bg-[#09090b] px-4 py-2 text-xs font-semibold text-white hover:bg-[#111113] disabled:opacity-50"
          >
            <Copy className="h-3.5 w-3.5" />
            Copiar
          </button>
          <button
            type="button"
            disabled={isFetching}
            onClick={onRegenerateDraft}
            className="inline-flex items-center gap-2 rounded-lg border border-[#27272a] bg-[#09090b] px-4 py-2 text-xs font-semibold text-white hover:bg-[#111113] disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching ? 'animate-spin' : '')} />
            {isFetching ? 'Gerando...' : 'Regenerar'}
          </button>
          <div className="ml-auto flex gap-0.5">
            <button type="button" className="rounded-md p-2 text-white hover:bg-[#111113]" title="Resposta útil">
              <ThumbsUp className="h-3.5 w-3.5" />
            </button>
            <button type="button" className="rounded-md p-2 text-white hover:bg-[#111113]" title="Resposta ruim">
              <ThumbsDown className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </section>
      <section className="rounded-xl border border-[#27272a] bg-[#18181b] p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[#71717a]">Por que essa resposta?</div>
        <ul className="space-y-2 text-xs text-[#a1a1aa]">
          {(briefing?.operational_context || []).length ? (
            <>
              <ReasonItem text="Usa o contexto operacional da conversa aberta." />
              <ReasonItem text={`Tom selecionado: ${selectedReplyTone}.`} />
            </>
          ) : (
            <li>Sem contexto</li>
          )}
        </ul>
      </section>
      <p className="text-[10px] text-[#71717a]">
        A orientação interna usa ferramentas (ficha, lacunas de cadastro). Após consultar, o rascunho para o cliente é atualizado com os dados em falta. Use &quot;Regenerar&quot; para refazer só o rascunho.
      </p>
    </div>
  );
}

function ReasonItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-[#2563eb] text-[9px] text-[#60a5fa]">○</span>
      <span>{text}</span>
    </li>
  );
}

function ChatTab({
  messages,
  chatMut,
  draft,
  setDraft,
  onSend,
  onInsertToComposer,
}: {
  messages: ChatMsg[];
  chatMut: ReturnType<typeof useMutation<CopilotChatResponse, Error, string>>;
  draft: string;
  setDraft: (value: string) => void;
  onSend: () => void;
  onInsertToComposer: (text: string) => void;
}) {
  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col space-y-3">
      {messages.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface-elevated p-3 text-xs text-muted-foreground">
          Pergunte sobre a conversa, regras ou dados operacionais. Ex.: &quot;Resuma o problema em 3 linhas e sugira resposta ao cliente&quot;.
        </div>
      ) : null}

      {messages.map((m, idx) => (
        <div key={`${idx}-${m.role}`} className={cn('flex animate-fade-in', m.role === 'user' ? 'justify-end' : 'justify-start')}>
          <div
            className={cn(
              'max-w-[85%] rounded-2xl px-3 py-2.5 text-[12px] leading-relaxed',
              m.role === 'user' ? 'whitespace-pre-wrap' : '',
              m.role === 'user'
                ? 'bg-primary text-primary-foreground rounded-br-sm'
                : 'bg-surface-elevated border border-border text-foreground rounded-bl-sm'
            )}
          >
            {m.role === 'assistant' ? <CopilotAssistantMarkdown content={m.content} /> : m.content}
            {m.role === 'assistant' ? (
              <div className="mt-2 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => onInsertToComposer(m.content)}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background/70 px-2 py-1 text-[10px] font-medium text-foreground hover:bg-surface-hover"
                >
                  <Copy className="h-3 w-3" />
                  Inserir no composer
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ))}

      {chatMut.isError ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {(chatMut.error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
            (chatMut.error instanceof Error ? chatMut.error.message : 'Falha ao consultar o copiloto.')}
        </p>
      ) : null}

      <div className="mt-auto border-t border-border pt-3">
        <div className="mb-2 flex flex-wrap gap-1">
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => setDraft(prompt)}
              className="rounded-full border border-border bg-background/50 px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            >
              {prompt}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            rows={2}
            placeholder="Pergunte ao Copiloto..."
            disabled={chatMut.isPending}
            className="min-h-10 flex-1 resize-none rounded-xl border border-border bg-background/60 px-3 py-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
          />
          <button
            type="button"
            disabled={chatMut.isPending || !draft.trim()}
            onClick={onSend}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50"
          >
            {chatMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </button>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">Conversa privada: o cliente não vê este chat.</p>
      </div>
    </div>
  );
}
