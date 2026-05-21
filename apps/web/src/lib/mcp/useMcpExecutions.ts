'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export type McpExecutionRow = {
  id: string;
  ticket_id: string | null;
  event_type: string;
  payload: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
};

export function useMcpExecutions(filters: {
  conversation_id?: string;
  ticket_id?: string;
  limit?: number;
  enabled?: boolean;
}) {
  const { conversation_id, ticket_id, limit = 50, enabled = true } = filters;

  return useQuery({
    queryKey: ['mcp', 'executions', conversation_id, ticket_id, limit],
    enabled,
    queryFn: async () => {
      const params: Record<string, string | number> = { limit };
      if (conversation_id?.trim()) params.conversation_id = conversation_id.trim();
      if (ticket_id?.trim()) params.ticket_id = ticket_id.trim();
      const res = await api.get('/api/mcp/executions', { params });
      return (res.data || []) as McpExecutionRow[];
    },
  });
}
