import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { toUiConversation } from '@/lib/inbox/inboxFormatters';
import type { ApiConversationListResponse, InboxConvQueryFilters } from '@/lib/inbox/types';

export function buildInboxConvQuery(filters: InboxConvQueryFilters): string {
  const params = new URLSearchParams();
  params.set('limit', filters.isSupervisor || filters.isAdmin ? '220' : '160');
  if (filters.priorityFilter !== 'all') params.set('priority', filters.priorityFilter);
  // Canal é filtrado no cliente (OperationalContextBar) para não esconder conversas de outros canais na API.

  if (filters.supervisorAttendantId) params.set('attendant_id', filters.supervisorAttendantId);
  if (filters.sectorFilterId) params.set('sector_id', filters.sectorFilterId);

  if (filters.isSupervisor) {
    if (filters.folder === 'supervisor_escalated') params.set('escalated_supervisor', '1');
    if (filters.supervisorAttendanceGroup !== 'all') params.set('attendance_group', filters.supervisorAttendanceGroup);
    else if (filters.statusFilter !== 'all') params.set('status', filters.statusFilter);
    if (filters.supervisorSlaStage && filters.supervisorSlaBucket) {
      params.set('sla_stage', filters.supervisorSlaStage);
      params.set('sla_bucket', filters.supervisorSlaBucket);
    }
  } else if (filters.statusFilter !== 'all') {
    params.set('status', filters.statusFilter);
  }

  return params.toString();
}

/** Fallback quando SSE indisponível; false pausa polling (aba em background ou SSE ativo). */
export const INBOX_POLL_FALLBACK_MS = 60_000;

export function useInboxConversations(
  canFetch: boolean,
  filters: InboxConvQueryFilters,
  nowMinute: number,
  isSupervisor: boolean,
  refetchInterval: number | false = false
) {
  const convQuery = useMemo(() => buildInboxConvQuery(filters), [filters]);

  const { data: convResp, isLoading: isConvsLoading, isError: isConvsError, refetch: refetchConvs } = useQuery({
    queryKey: ['inbox', 'conversations', convQuery],
    enabled: canFetch,
    staleTime: 30_000,
    refetchInterval,
    queryFn: () => api.get(`/api/conversations?${convQuery}`).then((r) => r.data as ApiConversationListResponse),
  });

  const { data: escCountResp } = useQuery({
    queryKey: ['inbox', 'supervisor-escalation-count'],
    enabled: canFetch && isSupervisor,
    queryFn: () =>
      api
        .get('/api/conversations?escalated_supervisor=1&limit=1&page=1')
        .then((r) => r.data as ApiConversationListResponse),
    staleTime: 45_000,
  });

  const uiAll = useMemo(
    () => (convResp?.data || []).map((c) => toUiConversation(c, nowMinute)),
    [convResp?.data, nowMinute]
  );

  return {
    convQuery,
    convResp,
    escCountResp,
    uiAll,
    isConvsLoading,
    isConvsError,
    refetchConvs,
  } as const;
}
