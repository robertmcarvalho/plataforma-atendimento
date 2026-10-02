'use client';

import Link from 'next/link';
import { ExternalLink, MessageCircle, X } from 'lucide-react';
import { MessageBubble } from '@/components/ui/MessageBubble';
import {
  useLead,
  useLeadConversation,
  useStartLeadConversation,
} from '@/lib/commercial/useCommercialQueries';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { useState } from 'react';
import {
  commercialReviveOutlineButtonClassName,
  commercialRevivePrimaryButtonClassName,
} from '@/components/commercial/CommercialRevivePrimitives';

type Props = {
  leadId: string;
  leadName: string;
  open: boolean;
  onClose: () => void;
  onStartProspeccao?: () => void;
};

export function CommercialChatDrawer({ leadId, leadName, open, onClose, onStartProspeccao }: Props) {
  const { data: lead } = useLead(leadId);
  const { data: convData, refetch } = useLeadConversation(leadId, open);
  const startConversation = useStartLeadConversation();
  const [error, setError] = useState<string | null>(null);

  const messages = convData?.messages ?? [];
  const convId =
    (convData?.conversation?.id as string | undefined) ?? lead?.commercial_conversation_id ?? undefined;

  if (!open) return null;

  const handleStart = () => {
    setError(null);
    if (onStartProspeccao) {
      onStartProspeccao();
      return;
    }
    void (async () => {
      try {
        await startConversation.mutateAsync(leadId);
        await refetch();
      } catch (e) {
        setError(apiErrorMessage(e));
      }
    })();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
      <div className="flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-elevated">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <MessageCircle className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">WhatsApp comercial</p>
                <p className="text-sm font-semibold">{leadName}</p>
              </div>
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground" aria-label="Fechar">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-background/20 p-4">
          {error ? <p className="mb-2 text-xs text-destructive">{error}</p> : null}
          {messages.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-background/40 p-6 text-center text-sm text-muted-foreground">
              <p>Nenhuma mensagem ainda.</p>
              <button type="button" className={`mt-3 ${commercialRevivePrimaryButtonClassName}`} onClick={handleStart}>
                {onStartProspeccao ? 'Iniciar prospecção' : 'Iniciar conversa comercial'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  model={{
                    kind: 'message',
                    id: m.id,
                    direction: m.direction,
                    type: 'text',
                    content: m.content || '',
                    created_at: m.created_at,
                    status: m.status,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-border bg-surface p-3">
          <Link
            href={
              convId
                ? `/inbox?commercial_lead_id=${leadId}&conversation_id=${convId}`
                : `/inbox?commercial_lead_id=${leadId}`
            }
            className={`mb-2 flex w-full items-center justify-center gap-1 ${commercialReviveOutlineButtonClassName}`}
          >
            Abrir na caixa (canal comercial) <ExternalLink className="h-3 w-3" />
          </Link>
          <p className="text-center text-[11px] text-muted-foreground">
            Envio de mensagens pela caixa unificada (janela 24h / templates Meta).
          </p>
        </div>
      </div>
    </div>
  );
}
