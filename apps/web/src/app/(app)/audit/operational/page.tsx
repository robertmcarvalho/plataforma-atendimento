'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/ui/PageHeader';
import api from '@/lib/api';

type McpExecution = {
  id: string;
  ticket_id: string | null;
  event_type: string;
  payload: {
    tool?: string;
    action?: string;
    latency_ms?: number;
    context?: { conversation_id?: string; ticket_id?: string };
    result?: { ok?: boolean; note?: string };
  } | null;
  created_by: string | null;
  created_at: string;
};

export default function OperationalAuditPage() {
  const [conversationId, setConversationId] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [limit, setLimit] = useState(50);

  const executionsQuery = useQuery({
    queryKey: ['audit-operational', conversationId, ticketId, limit],
    queryFn: async () => {
      const params: Record<string, string | number> = { limit };
      if (conversationId.trim()) params.conversation_id = conversationId.trim();
      if (ticketId.trim()) params.ticket_id = ticketId.trim();
      const res = await api.get('/api/mcp/executions', { params });
      return (res.data || []) as McpExecution[];
    },
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-8 py-8">
        <PageHeader
          eyebrow="Auditoria"
          title="Operacional (MCP)"
          description="Execuções de ferramentas MCP com filtros por conversa/ticket."
          actions={
            <button
              onClick={() => void executionsQuery.refetch()}
              className="rounded-md border border-border bg-background/40 px-3 py-1.5 text-xs text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            >
              Atualizar
            </button>
          }
        />

        <div className="panel mb-4 grid grid-cols-3 gap-3 rounded-xl p-4">
          <input
            value={conversationId}
            onChange={(e) => setConversationId(e.target.value)}
            className="control-input !rounded-lg !py-2 !text-xs"
            placeholder="conversation_id"
          />
          <input
            value={ticketId}
            onChange={(e) => setTicketId(e.target.value)}
            className="control-input !rounded-lg !py-2 !text-xs"
            placeholder="ticket_id"
          />
          <select
            value={String(limit)}
            onChange={(e) => setLimit(Number(e.target.value) || 50)}
            className="control-select !rounded-lg !py-2 !text-xs"
          >
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
          </select>
        </div>

        {executionsQuery.isError ? <div className="mb-3 text-xs text-destructive">Falha ao carregar auditoria operacional.</div> : null}

        <div className="overflow-x-auto rounded-xl border border-border/60 bg-background/30">
          <table className="workspace-table min-w-[720px]">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Tool / Action</th>
                <th>Contexto</th>
                <th>Latência</th>
                <th>Autor</th>
              </tr>
            </thead>
            <tbody>
              {executionsQuery.isLoading ? (
                <tr>
                  <td colSpan={5} className="workspace-cell py-6 text-sm text-muted-foreground">
                    Carregando...
                  </td>
                </tr>
              ) : (executionsQuery.data || []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="workspace-cell py-6 text-sm text-muted-foreground">
                    Nenhuma execução MCP encontrada para os filtros.
                  </td>
                </tr>
              ) : (
                (executionsQuery.data || []).map((row) => (
                  <tr key={row.id} className="workspace-row">
                    <td className="workspace-cell whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleString('pt-BR')}
                    </td>
                    <td className="workspace-cell">
                      <div className="text-xs font-medium">{row.payload?.tool || '—'}</div>
                      <div className="font-mono text-[10px] text-subtle-foreground">{row.payload?.action || '—'}</div>
                    </td>
                    <td className="workspace-cell text-[10px] text-muted-foreground">
                      conv: {row.payload?.context?.conversation_id || '—'}
                      <br />
                      ticket: {row.payload?.context?.ticket_id || row.ticket_id || '—'}
                    </td>
                    <td className="workspace-cell text-xs text-muted-foreground">{row.payload?.latency_ms ?? '—'} ms</td>
                    <td className="workspace-cell text-[10px] text-subtle-foreground">{row.created_by || 'system'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
