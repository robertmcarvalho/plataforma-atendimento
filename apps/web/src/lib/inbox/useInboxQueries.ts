import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Channel } from '@/components/ui/ChannelBadge';
import type { AdvanceEntryPrefill } from '@/components/inbox/InboxAdvanceEntryDrawer';
import type { TemplatePickerOption } from '@/components/inbox/NewConversationModal';
import api from '@/lib/api';
import { cadastroHrefFromContext } from '@/lib/inbox/inboxFormatters';
import { buildInboxFolderRows, dedupeInboxConversationsByPhone, filterInboxConversations } from '@/lib/inbox/inboxListFilters';
import { activeMentionQuery } from '@/lib/inbox/inboxMention';
import { applyInboxStreamEvent } from '@/lib/inbox/inboxStreamCache';
import { INBOX_POLL_FALLBACK_MS, useInboxConversations } from '@/lib/inbox/useInboxConversations';
import { useDocumentVisible } from '@/lib/inbox/useDocumentVisible';
import { useInboxEventStream } from '@/lib/inbox/useInboxEventStream';
import type {
  ApiContactConversation,
  ApiConversationDetail,
  ApiConversationPriority,
  ApiConversationStatus,
  ApiConversationTagCatalogRow,
  ApiOperationalTicket,
  ApiPendingTask,
  ApiSector,
  ApiTaskSummary,
  ApiUser,
  FolderKey,
  InboxConvQueryFilters,
  MentionCandidate,
} from '@/lib/inbox/types';
import { inboxChannels } from '@/lib/inbox/inboxChannels';
import { isToday } from 'date-fns';
import type { ContactDetail } from '@/types/contact';

type ConversationAdvanceTask = {
  id: string;
  title?: string;
  description?: string | null;
  phase?: string;
  driver_id?: string | null;
  metadata?: Record<string, unknown>;
};

export type UseInboxQueriesInput = {
  canFetch: boolean;
  userId?: string;
  canStartStaffConversation: boolean;
  canDecideAdvance: boolean;
  canUseSlaAlerts: boolean;
  isSupervisor: boolean;
  isAdmin?: boolean;
  canFilterByAttendant: boolean;
  isCommercialTeam?: boolean;
  nowMinute: number;
  folder: FolderKey;
  search: string;
  statusFilter: 'all' | ApiConversationStatus;
  priorityFilter: 'all' | ApiConversationPriority;
  channelFilter: 'all' | Channel;
  favorites: Record<string, true>;
  activeId: string;
  setActiveId: (id: string) => void;
  supervisorMainTab: 'conversations' | 'tasks' | 'tickets';
  supervisorAttendantId: string;
  supervisorAttendanceGroup: 'all' | 'active' | 'waiting' | 'finished';
  supervisorSlaStage: '' | 'first_response' | 'treatment' | 'resolution';
  supervisorSlaBucket: '' | 'breached' | 'at_risk' | 'on_track';
  supervisorTaskStatus: 'all' | 'open' | 'in_progress' | 'done' | 'cancelled';
  supervisorTaskType: string;
  supervisorTicketStatus: 'all' | 'open' | 'in_progress' | 'overdue' | 'resolved';
  sectorFilterId: string;
  selectedChannel?: { id: string; channel_type: string } | null;
  selectedChannelId?: string | null;
  transferOpen: boolean;
  showNewConversation: boolean;
  noteOpen: boolean;
  noteText: string;
  noteCaret: number;
  advanceEntryDrawerOpen: boolean;
  advanceEntryTaskId: string | null;
};

export function useInboxQueries(input: UseInboxQueriesInput) {
  const {
    canFetch,
    userId,
    canStartStaffConversation,
    canDecideAdvance,
    canUseSlaAlerts,
    isSupervisor,
    isAdmin = false,
    canFilterByAttendant,
    isCommercialTeam = false,
    nowMinute,
    folder,
    search,
    statusFilter,
    priorityFilter,
    channelFilter,
    favorites,
    activeId,
    setActiveId,
    supervisorMainTab,
    supervisorAttendantId,
    supervisorAttendanceGroup,
    supervisorSlaStage,
    supervisorSlaBucket,
    supervisorTaskStatus,
    supervisorTaskType,
    supervisorTicketStatus,
    sectorFilterId,
    selectedChannel,
    selectedChannelId,
    transferOpen,
    showNewConversation,
    noteOpen,
    noteText,
    noteCaret,
    advanceEntryDrawerOpen,
    advanceEntryTaskId,
  } = input;

  const { data: chatSignatureSetting } = useQuery({
    queryKey: ['settings', 'chat_signature_enabled'],
    enabled: canFetch,
    queryFn: async () => {
      const r = await api.get<boolean>('/api/settings/chat_signature_enabled');
      return r.data !== false;
    },
    staleTime: 60_000,
  });

  const convFilters: InboxConvQueryFilters = useMemo(
    () => ({
      isSupervisor,
      isAdmin,
      folder,
      priorityFilter,
      statusFilter,
      selectedChannelId: selectedChannelId || selectedChannel?.id,
      supervisorAttendanceGroup,
      supervisorAttendantId,
      supervisorSlaStage,
      supervisorSlaBucket,
      sectorFilterId,
    }),
    [
      folder,
      isSupervisor,
      isAdmin,
      priorityFilter,
      selectedChannelId,
      selectedChannel?.id,
      statusFilter,
      sectorFilterId,
      supervisorAttendanceGroup,
      supervisorAttendantId,
      supervisorSlaBucket,
      supervisorSlaStage,
    ]
  );

  const queryClient = useQueryClient();
  const documentVisible = useDocumentVisible();
  const [sseConnected, setSseConnected] = useState(false);
  const inboxPollInterval = useMemo(() => {
    if (!documentVisible) return false as const;
    if (sseConnected) return false as const;
    return INBOX_POLL_FALLBACK_MS;
  }, [documentVisible, sseConnected]);

  const { convQuery, escCountResp, uiAll, isConvsLoading, isConvsError, refetchConvs } = useInboxConversations(
    canFetch,
    convFilters,
    nowMinute,
    isSupervisor,
    inboxPollInterval
  );

  const mentionTasksQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set('status', 'open');
    p.set('limit', '200');
    if (userId) p.set('assignee_id', userId);
    return p.toString();
  }, [userId]);

  const { data: myOpenTasks = [] } = useQuery({
    queryKey: ['inbox', 'my-open-tasks', mentionTasksQuery],
    enabled: canFetch && Boolean(userId),
    staleTime: 30_000,
    refetchInterval: 45_000,
    queryFn: () => api.get(`/api/tasks?${mentionTasksQuery}`).then((r) => r.data as ApiPendingTask[]),
  });

  const mentionConversationIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of myOpenTasks) {
      if (t.task_type === 'internal_note_mention' && t.conversation_id) ids.add(t.conversation_id);
    }
    return ids;
  }, [myOpenTasks]);

  const counts = useMemo(() => {
    const mine = uiAll.filter(
      (c) => c.raw.status !== 'resolved' && c.raw.attendant_id && userId && c.raw.attendant_id === userId
    ).length;
    const unassigned = uiAll.filter((c) => c.raw.status !== 'resolved' && !c.raw.attendant_id).length;
    const pending = uiAll.filter((c) => c.raw.status === 'pending').length;
    const resolvedToday = uiAll.filter(
      (c) => c.raw.status === 'resolved' && c.raw.resolved_at && isToday(new Date(c.raw.resolved_at))
    ).length;
    const sectorOpen = uiAll.filter((c) => c.raw.status !== 'closed').length;
    const mentions = myOpenTasks.filter((t) => t.task_type === 'internal_note_mention').length;
    return { mine, unassigned, pending, resolvedToday, mentions, sectorOpen };
  }, [myOpenTasks, uiAll, userId]);

  const { data: taskSummary } = useQuery({
    queryKey: ['inbox', 'tasks-summary'],
    enabled: canFetch && canStartStaffConversation,
    queryFn: () => api.get('/api/tasks/summary').then((r) => r.data as ApiTaskSummary),
    refetchInterval: 12_000,
  });

  const folders = useMemo(
    () =>
      buildInboxFolderRows(counts, {
        isSupervisor,
        isAdmin,
        isCommercialTeam,
        escalatedTotal: typeof escCountResp?.total === 'number' ? escCountResp.total : 0,
        pendingTasksOpen: taskSummary?.open ?? 0,
      }),
    [counts, escCountResp?.total, isAdmin, isCommercialTeam, isSupervisor, taskSummary?.open]
  );

  const filteredConversations = useMemo(
    () =>
      dedupeInboxConversationsByPhone(
        filterInboxConversations(uiAll, {
        folder,
        userId,
        mentionConversationIds,
        search,
        channelFilter,
        selectedChannel,
        favorites,
        statusFilter,
        priorityFilter,
        supervisorAttendanceGroup: isSupervisor ? supervisorAttendanceGroup : 'all',
        attendantFilterId: supervisorAttendantId || undefined,
        }),
      ),
    [
      channelFilter,
      favorites,
      folder,
      isSupervisor,
      mentionConversationIds,
      priorityFilter,
      search,
      selectedChannel,
      statusFilter,
      supervisorAttendanceGroup,
      supervisorAttendantId,
      uiAll,
      userId,
    ]
  );

  const deepLinkConvRef = useRef<string | null>(null);
  useEffect(() => {
    if (!canFetch || typeof window === 'undefined') return;
    const cid = new URLSearchParams(window.location.search).get('conversation_id')?.trim();
    if (cid) deepLinkConvRef.current = cid;
  }, [canFetch]);

  useEffect(() => {
    if (isSupervisor && supervisorMainTab !== 'conversations') return;
    const deepId = deepLinkConvRef.current;
    if (deepId && filteredConversations.some((c) => c.id === deepId)) {
      setActiveId(deepId);
      deepLinkConvRef.current = null;
      return;
    }
    if (filteredConversations.length === 0) {
      setActiveId('');
      return;
    }
    if (!activeId || !filteredConversations.some((c) => c.id === activeId)) {
      setActiveId(filteredConversations[0].id);
    }
  }, [activeId, filteredConversations, isSupervisor, setActiveId, supervisorMainTab]);

  const active = useMemo(() => uiAll.find((c) => c.id === activeId) || null, [uiAll, activeId]);

  const {
    data: detail,
    isLoading: isDetailLoading,
    isError: isDetailError,
    refetch: refetchDetail,
  } = useQuery({
    queryKey: ['inbox', 'conversation', activeId],
    enabled: canFetch && Boolean(activeId),
    staleTime: 30_000,
    refetchInterval: inboxPollInterval,
    queryFn: () => api.get(`/api/conversations/${activeId}`).then((r) => r.data as ApiConversationDetail),
  });

  const { data: conversationAdvanceTask } = useQuery({
    queryKey: ['inbox', 'advance-task', activeId],
    enabled: canFetch && canDecideAdvance && Boolean(activeId),
    queryFn: async () => {
      const r = await api.get<{ task: ConversationAdvanceTask | null }>(`/api/tasks/for-conversation/${activeId}`);
      return r.data.task;
    },
    staleTime: 15_000,
  });

  const { data: advanceEntryContext } = useQuery({
    queryKey: ['inbox', 'task-context', advanceEntryTaskId],
    enabled: canFetch && Boolean(advanceEntryTaskId) && advanceEntryDrawerOpen,
    queryFn: async () =>
      (await api.get(`/api/tasks/${advanceEntryTaskId}/context`)).data as {
        entry_prefill?: AdvanceEntryPrefill;
        advance_context?: { requested_amount?: number; recommended_max_amount?: number };
        task?: { metadata?: Record<string, unknown> };
      },
  });

  const handleInboxStreamEvent = useCallback(
    (event: Parameters<typeof applyInboxStreamEvent>[1]) => {
      applyInboxStreamEvent(queryClient, event, {
        activeId,
        convQuery,
        refetchConvs: () => {
          void refetchConvs();
        },
        refetchDetail: () => {
          void refetchDetail();
        },
      });
    },
    [activeId, convQuery, queryClient, refetchConvs, refetchDetail]
  );

  useInboxEventStream(canFetch, {
    onEvent: handleInboxStreamEvent,
    onConnectionChange: setSseConnected,
  });

  const { data: usersRaw } = useQuery({
    queryKey: ['inbox', 'users', 'transfer'],
    enabled: canFetch && transferOpen,
    queryFn: () =>
      api
        .get('/api/users/attendants', { params: { scope: 'workspace', include_supervisors: '1' } })
        .then((r) => r.data as ApiUser[]),
  });

  const { data: sectors } = useQuery({
    queryKey: ['inbox', 'sectors'],
    enabled: canFetch,
    queryFn: () => api.get('/api/sectors').then((r) => r.data as ApiSector[]),
  });

  const { data: teamPresence } = useQuery({
    queryKey: ['presence', 'team'],
    enabled: canFetch && canFilterByAttendant,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: () =>
      api
        .get<{
          members: Array<{ user_id: string; name: string; presence: 'online' | 'idle' | 'offline' }>;
          online_count: number;
          idle_count: number;
          total: number;
        }>('/api/presence/team')
        .then((r) => r.data),
  });

  const { data: supervisorAttendantsRaw = [] } = useQuery({
    queryKey: ['inbox', 'sector-attendants', isAdmin ? 'workspace' : 'sector'],
    enabled: canFetch && canFilterByAttendant,
    queryFn: () =>
      api
        .get('/api/users/attendants', {
          params: {
            // sector: supervisores veem o setor; admin/elevated recebem todos no backend
            scope: isAdmin ? 'workspace' : 'sector',
            include_supervisors: '1',
          },
        })
        .then((r) => r.data as ApiUser[]),
  });

  const supervisorAttendants = useMemo(() => {
    const byId = new Map<string, ApiUser>();
    for (const u of supervisorAttendantsRaw) byId.set(u.id, u);
    for (const m of teamPresence?.members ?? []) {
      if (!byId.has(m.user_id)) byId.set(m.user_id, { id: m.user_id, name: m.name });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [supervisorAttendantsRaw, teamPresence?.members]);

  const supervisorTasksQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', '120');
    p.set('status', supervisorTaskStatus);
    if (supervisorAttendantId) p.set('assignee_id', supervisorAttendantId);
    if (supervisorTaskType) p.set('task_type', supervisorTaskType);
    return p.toString();
  }, [supervisorAttendantId, supervisorTaskStatus, supervisorTaskType]);

  const { data: supervisorTasksPanel = [] } = useQuery({
    queryKey: ['inbox', 'supervisor-tasks-panel', supervisorTasksQuery],
    enabled: canFetch && isSupervisor && supervisorMainTab === 'tasks',
    queryFn: () => api.get(`/api/tasks?${supervisorTasksQuery}`).then((r) => r.data as ApiPendingTask[]),
  });

  const supervisorTicketsQuery = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', '120');
    if (supervisorTicketStatus !== 'all') p.set('status', supervisorTicketStatus);
    if (supervisorAttendantId) p.set('assignee_user_id', supervisorAttendantId);
    return p.toString();
  }, [supervisorAttendantId, supervisorTicketStatus]);

  const { data: supervisorTicketsPanel = [] } = useQuery({
    queryKey: ['inbox', 'supervisor-tickets-panel', supervisorTicketsQuery],
    enabled: canFetch && isSupervisor && supervisorMainTab === 'tickets',
    queryFn: () => api.get(`/api/tickets?${supervisorTicketsQuery}`).then((r) => r.data as ApiOperationalTicket[]),
  });

  const { data: mentionCandidates = [] } = useQuery({
    queryKey: ['users', 'mention-candidates'],
    enabled: canFetch && noteOpen,
    queryFn: () => api.get<MentionCandidate[]>('/api/users/mention-candidates').then((r) => r.data),
    staleTime: 120_000,
  });

  const noteMentionQuery = useMemo(
    () => (noteOpen ? activeMentionQuery(noteText, noteCaret) : null),
    [noteCaret, noteOpen, noteText]
  );

  const filteredMentionCandidates = useMemo(() => {
    if (noteMentionQuery === null) return [];
    const q = noteMentionQuery.trim().toLowerCase();
    return mentionCandidates
      .filter((c) => c.name && (!q || c.name.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [mentionCandidates, noteMentionQuery]);

  const { data: conversationTagCatalog = [] } = useQuery({
    queryKey: ['conversation-tags', 'catalog'],
    enabled: canFetch,
    queryFn: () => api.get('/api/conversation-tags').then((r) => r.data as ApiConversationTagCatalogRow[]),
    staleTime: 300_000,
  });

  const tagLabelBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of conversationTagCatalog) m.set(row.slug, row.label_pt);
    return m;
  }, [conversationTagCatalog]);

  const tagToneBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of conversationTagCatalog) m.set(row.slug, row.tone || 'neutral');
    return m;
  }, [conversationTagCatalog]);

  // Nova conversa: lista = canal do seletor (mesmo do POST). Conversa aberta: canal da conversa.
  // Evita template comercial na lista enquanto o envio usa o operacional (#132001).
  const templateChannelId = showNewConversation
    ? selectedChannelId || null
    : detail?.workspace_channel_id || active?.raw.workspace_channel_id || selectedChannelId || null;
  const templatePurposeFallback = templateChannelId
    ? undefined
    : isCommercialTeam
      ? 'commercial'
      : 'operational';
  const needsApprovedTemplates = showNewConversation || Boolean(activeId);
  const { data: templatesData } = useQuery<TemplatePickerOption[]>({
    queryKey: ['approved-templates-for-inbox', templateChannelId, templatePurposeFallback, showNewConversation],
    enabled: canFetch && needsApprovedTemplates,
    queryFn: () =>
      api
        .get('/api/templates/list/approved', {
          params: {
            ...(templateChannelId ? { workspace_channel_id: templateChannelId } : {}),
            ...(templatePurposeFallback ? { purpose: templatePurposeFallback } : {}),
          },
        })
        .then((response) => response.data),
  });

  const contactId = detail?.contacts?.id || active?.raw?.contacts?.id || null;

  const { data: contact } = useQuery({
    queryKey: ['inbox', 'contact', contactId],
    enabled: canFetch && Boolean(contactId),
    queryFn: () => api.get(`/api/contacts/${contactId}`).then((r) => r.data as ContactDetail),
  });

  const cadastroHref = useMemo(() => cadastroHrefFromContext(detail, contact), [contact, detail]);

  const { data: previousConversations } = useQuery({
    queryKey: ['inbox', 'contact-conversations', contactId, activeId],
    enabled: canFetch && Boolean(contactId) && Boolean(activeId),
    queryFn: async () => {
      const res = await api.get(`/api/contacts/${contactId}/conversations`, { params: { exclude: activeId, limit: 5 } });
      return res.data as ApiContactConversation[];
    },
  });

  const lastReadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!canFetch || !activeId) return;
    if (lastReadRef.current === activeId) return;
    lastReadRef.current = activeId;
    void api.patch(`/api/conversations/${activeId}/read`).catch(() => undefined);
  }, [activeId, canFetch]);

  const unreadCount = useMemo(
    () => filteredConversations.filter((c) => Boolean(c.unread)).length,
    [filteredConversations]
  );

  const channelCounts = useMemo(() => {
    const map = new Map<Channel, number>();
    for (const ch of inboxChannels) map.set(ch, ch === 'whatsapp' ? uiAll.length : 0);
    return map;
  }, [uiAll.length]);

  return {
    chatSignatureEnabled: chatSignatureSetting !== false,
    convQuery,
    uiAll,
    isConvsLoading,
    isConvsError,
    refetchConvs,
    folders,
    filteredConversations,
    active,
    detail,
    isDetailLoading,
    isDetailError,
    refetchDetail,
    conversationAdvanceTask,
    advanceEntryContext,
    users: usersRaw,
    sectors,
    supervisorAttendants,
    teamPresence,
    supervisorTasksPanel,
    supervisorTicketsPanel,
    filteredMentionCandidates,
    conversationTagCatalog,
    tagLabelBySlug,
    tagToneBySlug,
    templatesData,
    contactId,
    contact,
    cadastroHref,
    previousConversations,
    unreadCount,
    channelCounts,
  };
}
