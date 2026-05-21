'use client';

import { useMutation } from '@tanstack/react-query';
import api from '@/lib/api';

export type McpExecutePayload = {
  tool: string;
  action: string;
  input?: Record<string, unknown>;
  context?: Record<string, unknown>;
};

export function useMcpExecute() {
  return useMutation({
    mutationFn: async (payload: McpExecutePayload) => {
      const res = await api.post('/api/mcp/execute', payload);
      return (res.data || {}) as Record<string, unknown>;
    },
  });
}
