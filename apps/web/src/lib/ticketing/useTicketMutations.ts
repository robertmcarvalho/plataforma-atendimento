'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import type { TicketStatus } from './types';

export function useTicketMutations(ticketId: string | null | undefined, conversationId: string | null) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (status: TicketStatus) => {
      if (!ticketId) throw new Error('Ticket não disponível.');
      const res = await api.patch(`/api/tickets/${ticketId}`, { status });
      return res.data;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['ticketing', 'active-ticket', conversationId] }),
        qc.invalidateQueries({ queryKey: ['ticketing', 'timeline', ticketId] }),
      ]);
    },
  });
}
