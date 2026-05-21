'use client';

import { useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import { useState } from 'react';

type TicketLite = {
  id: string;
  type: string;
  priority: string;
  status: string;
  context_snap?: Record<string, unknown> | null;
};

export function RoutingExplainCard({ ticket, conversationId }: { ticket: TicketLite | null; conversationId: string | null }) {
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const explainRouting = useMutation({
    mutationFn: async () => {
      const payload = {
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
        context: { source: 'inbox_unificado' },
      };
      const res = await api.post('/api/mcp/execute', payload);
      return (res.data || {}) as Record<string, unknown>;
    },
    onSuccess: (data) => setResult(data),
  });

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs text-[var(--text-muted)]">Por que foi roteado?</p>
        <button
          onClick={() => explainRouting.mutate()}
          disabled={explainRouting.isPending || !conversationId}
          className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-60"
        >
          {explainRouting.isPending ? 'Analisando...' : 'Explicar roteamento'}
        </button>
      </div>
      {explainRouting.isError ? <p className="text-xs text-red-300">Falha ao obter explicação de roteamento.</p> : null}
      {result ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-[10px] text-[var(--text-muted)]">
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : (
        <p className="text-xs text-[var(--text-muted)]">Executa `mcp-routing.explain_routing` com contexto do ticket e da conversa.</p>
      )}
    </div>
  );
}
