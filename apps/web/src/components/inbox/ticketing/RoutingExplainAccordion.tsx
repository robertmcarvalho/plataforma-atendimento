'use client';

import { useState } from 'react';
import { useMcpExecute } from '@/lib/mcp/useMcpExecute';
import type { OperationalTicket } from '@/lib/ticketing/types';

export function RoutingExplainAccordion({
  ticket,
  conversationId,
}: {
  ticket: OperationalTicket | null;
  conversationId: string | null;
}) {
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const explainRouting = useMcpExecute();

  return (
    <details className="inbox-context-accordion">
      <summary className="inbox-context-accordion-summary">
        <span className="inbox-context-title" style={{ marginBottom: 0 }}>
          Por que foi roteado?
        </span>
        <span className="inbox-context-chevron">+</span>
      </summary>
      <div className="inbox-context-grid">
        <div className="col-span-full flex items-center justify-end">
          <button
            type="button"
            onClick={() => {
              setResult(null);
              explainRouting.mutate(
                {
                  tool: 'mcp-routing',
                  action: 'explain_routing',
                  input: {
                    conversation_id: conversationId,
                    ticket_id: ticket?.id || null,
                    ticket_type: ticket?.type || null,
                    priority: ticket?.priority || null,
                    status: ticket?.status || null,
                    context_snap: ticket?.context_snap || null,
                  },
                  context: { source: 'inbox' },
                },
                { onSuccess: (data) => setResult(data) }
              );
            }}
            disabled={explainRouting.isPending || !conversationId}
            className="button-secondary rounded-md px-3 py-1.5 text-[11px] font-medium disabled:opacity-50"
          >
            {explainRouting.isPending ? 'Analisando…' : 'Explicar roteamento'}
          </button>
        </div>
        {explainRouting.isError ? (
          <p className="col-span-full text-[11px] text-destructive">Falha ao obter explicação de roteamento.</p>
        ) : null}
        {result ? (
          <pre className="col-span-full max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background/40 p-2 font-mono text-[10px] text-muted-foreground">
            {JSON.stringify(result, null, 2)}
          </pre>
        ) : (
          <p className="col-span-full text-[11px] text-muted-foreground">
            Executa <span className="font-mono text-[10px]">mcp-routing.explain_routing</span> com o contexto atual.
          </p>
        )}
      </div>
    </details>
  );
}
