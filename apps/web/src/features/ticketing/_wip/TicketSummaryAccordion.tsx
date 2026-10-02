// WIP � feature paused. Flag: ticketingPanel in lib/features.ts
// Do not delete. Context: codebase audit Phase A (ticketing panel soft-pause)

'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SlaBadge } from './SlaBadge';
import { useTicketMutations } from '@/lib/ticketing/useTicketMutations';
import type { OperationalTicket } from '@/lib/ticketing/types';

export function TicketSummaryAccordion({
  ticket,
  conversationId,
  loading,
}: {
  ticket: OperationalTicket | null;
  conversationId: string | null;
  loading?: boolean;
}) {
  const mutation = useTicketMutations(ticket?.id, conversationId);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'err'; message: string } | null>(null);

  return (
    <details className="inbox-context-accordion" open>
      <summary className="inbox-context-accordion-summary">
        <div className="flex items-center gap-2">
          <span className="inbox-context-title" style={{ marginBottom: 0 }}>
            Ticket operacional
          </span>
          {ticket ? <SlaBadge ticket={ticket} /> : null}
        </div>
        <span className="inbox-context-chevron">+</span>
      </summary>
      <div className="inbox-context-grid">
        {loading ? (
          <p className="inbox-context-field-value col-span-full text-xs text-muted-foreground">Carregando ticket…</p>
        ) : null}
        {!loading && !ticket ? (
          <p className="inbox-context-field-value col-span-full text-xs text-muted-foreground">
            Nenhum ticket estruturado para esta conversa.
          </p>
        ) : null}
        {ticket ? (
          <>
            <div>
              <div className="inbox-context-field-label">Código</div>
              <div className="inbox-context-field-value">{ticket.ticket_code}</div>
            </div>
            <div>
              <div className="inbox-context-field-label">Tipo</div>
              <div className="inbox-context-field-value">{ticket.type}</div>
            </div>
            <div>
              <div className="inbox-context-field-label">Prioridade</div>
              <div className="inbox-context-field-value">{ticket.priority}</div>
            </div>
            <div>
              <div className="inbox-context-field-label">Status</div>
              <div className="inbox-context-field-value">{ticket.status}</div>
            </div>
            <div>
              <div className="inbox-context-field-label">SLA (min)</div>
              <div className="inbox-context-field-value">{String(ticket.sla_minutes)}</div>
            </div>

            <div className="col-span-full flex flex-wrap gap-2 pt-1">
              <Button
                type="button"
                onClick={() => {
                  setFeedback(null);
                  mutation.mutate('in_progress', {
                    onSuccess: () => setFeedback({ tone: 'ok', message: 'Status: em atendimento.' }),
                    onError: () => setFeedback({ tone: 'err', message: 'Falha ao atualizar ticket.' }),
                  });
                }}
                disabled={!ticket.id || mutation.isPending}
                variant="secondary"
                className="rounded-md px-2 py-1 text-[11px] font-medium"
              >
                Em atendimento
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setFeedback(null);
                  mutation.mutate('resolved', {
                    onSuccess: () => setFeedback({ tone: 'ok', message: 'Ticket resolvido.' }),
                    onError: () => setFeedback({ tone: 'err', message: 'Falha ao atualizar ticket.' }),
                  });
                }}
                disabled={!ticket.id || mutation.isPending}
                variant="secondary"
                className="rounded-md px-2 py-1 text-[11px] font-medium"
              >
                Resolver
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setFeedback(null);
                  mutation.mutate('open', {
                    onSuccess: () => setFeedback({ tone: 'ok', message: 'Ticket reaberto.' }),
                    onError: () => setFeedback({ tone: 'err', message: 'Falha ao atualizar ticket.' }),
                  });
                }}
                disabled={!ticket.id || mutation.isPending}
                variant="secondary"
                className="rounded-md px-2 py-1 text-[11px] font-medium"
              >
                Reabrir
              </Button>
            </div>
            {feedback ? (
              <p
                className={cn(
                  'col-span-full text-[11px]',
                  feedback.tone === 'ok' ? 'text-muted-foreground' : 'text-destructive'
                )}
              >
                {feedback.message}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </details>
  );
}
