'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { OperationalTicket } from './types';

export function useActiveTicket(conversationId: string | null) {
  return useQuery({
    queryKey: ['ticketing', 'active-ticket', conversationId],
    enabled: Boolean(conversationId),
    queryFn: async () => {
      const res = await api.get('/api/tickets', {
        params: { conversation_id: conversationId, limit: 20 },
      });
      const rows = (res.data || []) as OperationalTicket[];
      return rows.find((t) => t.status === 'open' || t.status === 'in_progress') || rows[0] || null;
    },
  });
}
