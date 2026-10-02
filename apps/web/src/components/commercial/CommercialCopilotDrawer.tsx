'use client';

import { useCallback, useState } from 'react';
import { Loader2, Send, Sparkles, X } from 'lucide-react';
import { FormControl } from '@/components/form/FormControl';
import { CopilotAssistantMarkdown } from '@/components/copilot/CopilotAssistantMarkdown';
import { leadTemperatureLabel } from '@/lib/commercial/commercialFormat';
import { deriveLeadTemperature } from '@/lib/commercial/commercialScoring';
import type { CommercialLead, CommercialStage } from '@/lib/commercial/types';
import { useCopilotCommercialChat, useLeadScoring } from '@/lib/commercial/useCommercialQueries';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { cn } from '@/lib/utils';
import { commercialRevivePrimaryButtonClassName } from '@/components/commercial/CommercialRevivePrimitives';

type ChatMsg = { role: 'user' | 'assistant'; content: string };

const QUICK = ['Resumir lead', 'Próxima ação', 'Rascunho WhatsApp', 'Objeções prováveis'];

type Props = {
  lead: CommercialLead;
  stage?: CommercialStage;
  open: boolean;
  onClose: () => void;
};

export function CommercialCopilotDrawer({ lead, stage, open, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const copilot = useCopilotCommercialChat();
  const { data: scoring } = useLeadScoring(lead.id, true);

  const send = useCallback(
    async (text: string) => {
      const msg = text.trim();
      if (!msg || copilot.isPending) return;
      setMessages((prev) => [...prev, { role: 'user', content: msg }]);
      setDraft('');
      try {
        const res = await copilot.mutateAsync({ commercial_lead_id: lead.id, message: msg });
        setMessages((prev) => [...prev, { role: 'assistant', content: res.reply }]);
      } catch (e) {
        setMessages((prev) => [...prev, { role: 'assistant', content: apiErrorMessage(e) }]);
      }
    },
    [copilot, lead.id],
  );

  if (!open) return null;

  const temp =
    scoring?.status === 'ready' && scoring.lead_temperature
      ? scoring.lead_temperature
      : deriveLeadTemperature(lead, stage);
  const stageName = stage?.name ?? '—';

  return (
    <div className="fixed inset-0 z-[55] flex justify-end bg-black/60">
      <div className="flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-elevated">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Sparkles className="h-4 w-4" strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-sm font-semibold">Copiloto comercial</p>
                <p className="text-[11px] text-muted-foreground">
                  {lead.trade_name} · {leadTemperatureLabel(temp)}
                </p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground" aria-label="Fechar">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 border-b border-border bg-surface px-3 py-2">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => void send(q)}
              disabled={copilot.isPending}
              className="rounded-md border border-border bg-background/40 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-background/20 p-4">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Pergunte sobre <strong className="text-foreground">{lead.trade_name}</strong> (estágio {stageName}). O contexto inclui dados do lead
              e mensagens recentes da conversa comercial.
            </p>
          ) : (
            messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  'rounded-lg border border-border p-3 text-sm',
                  m.role === 'user' ? 'ml-8 border-primary/30 bg-primary/10' : 'mr-4 bg-surface',
                )}
              >
                {m.role === 'assistant' ? <CopilotAssistantMarkdown content={m.content} /> : m.content}
              </div>
            ))
          )}
          {copilot.isPending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Pensando...
            </div>
          ) : null}
        </div>

        <div className="border-t border-border bg-surface p-3">
          <div className="flex gap-2">
            <FormControl
              inputSize="md"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), void send(draft))}
              placeholder="Pergunte ao copiloto..."
              className="min-w-0 flex-1"
            />
            <button
              type="button"
              onClick={() => void send(draft)}
              disabled={copilot.isPending}
              className={cn(commercialRevivePrimaryButtonClassName, 'px-2.5')}
              aria-label="Enviar"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
