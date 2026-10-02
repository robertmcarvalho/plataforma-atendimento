'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Bot,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Loader2,
  MessagesSquare,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { extractCopilotComposerText } from '@/lib/copilot/extractCopilotComposerText';
import { CopilotAssistantMarkdown } from '@/components/copilot/CopilotAssistantMarkdown';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type ChatMsg = { role: 'user' | 'assistant'; content: string; composerText?: string };

type CopilotChatResponse = {
  reply: string;
  composer_text?: string;
  model?: string;
  sources?: { has_conversation_context?: boolean; entity_keys?: string[] };
};

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

const quickPrompts = ['Resumir', 'Sugerir resposta', 'Dados para cadastro', 'Verificar fluxo'];

export function CopilotPanel(props: {
  open: boolean;
  onClose: () => void;
  conversationId: string | null;
  onOpenContext?: () => void;
  onInsertToComposer: (text: string) => void;
  embedded?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}) {
  const { open, onClose, conversationId, onInsertToComposer, embedded = false } = props;
  const key = useMemo(() => storageKey(conversationId), [conversationId]);

  const [chatState, setChatState] = useState<{ key: string; messages: ChatMsg[] }>(() => ({ key, messages: loadStored(key) }));
  const [draft, setDraft] = useState('');
  const [internalCollapsed, setInternalCollapsed] = useState(true);
  const collapsed = props.collapsed ?? internalCollapsed;
  const setCollapsed = (v: boolean) => {
    setInternalCollapsed(v);
    props.onCollapsedChange?.(v);
  };
  const scrollRef = useRef<HTMLDivElement>(null);

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

  const send = useCallback(async () => {
    const msg = draft.trim();
    if (!msg || chatMut.isPending) return;
    try {
      const data = await chatMut.mutateAsync(msg);
      appendMessages((prev) => [
        ...prev,
        { role: 'user', content: msg },
        {
          role: 'assistant',
          content: data.reply || '',
          composerText:
            (data.composer_text || extractCopilotComposerText(data.reply || '')).trim() || undefined,
        },
      ]);
      setDraft('');
    } catch {
      /* erro exibido via chatMut */
    }
  }, [appendMessages, chatMut, draft]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, chatMut.isPending]);

  if (!open) return null;

  const shellClass = embedded
    ? 'flex h-full min-h-0 min-w-0 w-full flex-col border-l border-border bg-background'
    : 'fixed inset-y-0 right-0 z-[60] flex w-full max-w-[27.5rem] flex-col border-l border-border bg-background shadow-md';

  if (collapsed) {
    return (
      <div className={cn(shellClass, 'w-12 shrink-0 items-center gap-1 py-2')} role="complementary" aria-label="Copiloto interno">
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => setCollapsed(false)} className="text-primary" title="Expandir Copiloto">
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <div className="mt-1 flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setCollapsed(false)}
          className="text-primary"
          title="Chat do Copiloto"
        >
          <MessagesSquare className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} className="mt-auto text-muted-foreground" title="Fechar">
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className={cn(shellClass, embedded && 'w-full max-w-none')} role="dialog" aria-label="Copiloto interno">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold tracking-tight text-foreground">Copiloto</h3>
              <span className="rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                IA
              </span>
            </div>
            <div className="truncate text-[10px] text-muted-foreground">
              {conversationId ? 'Chat privado sobre a conversa aberta' : 'Selecione uma conversa para usar o chat'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setCollapsed(true)}
            className="text-muted-foreground"
            title="Recolher"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className="text-muted-foreground"
            title="Fechar"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
        <div className="mb-2 flex items-center gap-2 border-b border-border pb-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Bot className="h-3 w-3" />
          </div>
          <div className="text-[10px] text-muted-foreground">Conversa privada — o cliente não vê</div>
        </div>

        <div className="min-h-0 flex-1 space-y-3">
          {messages.length === 0 ? (
            <Card size="sm" className="gap-0 py-3 ring-0">
              <CardContent className="px-3 pt-0 text-xs text-muted-foreground">
                Pergunte sobre a conversa, regras ou dados operacionais.
              </CardContent>
            </Card>
          ) : null}

          {messages.map((m, idx) => (
            <div key={`${idx}-${m.role}`} className={cn('flex animate-fade-in', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              {m.role === 'user' ? (
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-3 py-2.5 text-[12px] leading-relaxed text-primary-foreground">
                  {m.content}
                </div>
              ) : (
                <Card size="sm" className="max-w-[85%] gap-0 rounded-2xl rounded-bl-sm py-2.5 ring-0">
                  <CardContent className="px-3 pt-0 text-[12px] leading-relaxed text-foreground">
                    <CopilotAssistantMarkdown content={m.content} />
                    <div className="mt-2 flex items-center justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => {
                          const text =
                            m.composerText?.trim() ||
                            extractCopilotComposerText(m.content).trim() ||
                            m.content.trim();
                          onInsertToComposer(text);
                        }}
                        className="gap-1 text-[10px]"
                      >
                        <Copy className="h-3 w-3" />
                        Inserir no composer
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          ))}

          {chatMut.isError ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive">
              {(chatMut.error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
                (chatMut.error instanceof Error ? chatMut.error.message : 'Falha ao consultar o copiloto.')}
            </p>
          ) : null}
        </div>

        <div className="mt-auto shrink-0 border-t border-border pt-2">
          <div className="mb-2 flex flex-wrap gap-1">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => setDraft(prompt)}
                className="rounded-full border border-border bg-background/50 px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
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
                  void send();
                }
              }}
              rows={2}
              placeholder="Pergunte ao Copiloto..."
              disabled={chatMut.isPending}
              className="min-h-10 flex-1 resize-none rounded-xl border border-border bg-background/60 px-3 py-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
            />
            <Button
              type="button"
              size="icon-sm"
              disabled={chatMut.isPending || !draft.trim()}
              onClick={() => void send()}
              className="shrink-0"
            >
              {chatMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
