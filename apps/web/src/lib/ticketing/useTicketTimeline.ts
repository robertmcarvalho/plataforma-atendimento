'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { TicketEventRow } from './types';

export function useTicketTimeline(ticketId: string | null | undefined) {
  return useQuery({
    queryKey: ['ticketing', 'timeline', ticketId],
    enabled: Boolean(ticketId),
    queryFn: async () => (await api.get(`/api/tickets/${ticketId}/timeline`)).data as TicketEventRow[],
  });
}
