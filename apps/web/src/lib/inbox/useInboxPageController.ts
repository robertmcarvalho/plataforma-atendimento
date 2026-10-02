import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMergedAiFeatures } from '@/lib/ai/useAiFeatures';
import { useOperationalContext } from '@/hooks/useOperationalContext';
import { useInboxDensity } from '@/hooks/useInboxDensity';
import { useInboxActions } from '@/lib/inbox/useInboxActions';
import { useInboxComposer } from '@/lib/inbox/useInboxComposer';
import { useInboxDerived } from '@/lib/inbox/useInboxDerived';
import { useInboxLayout } from '@/lib/inbox/useInboxLayout';
import { useInboxNotifications } from '@/lib/inbox/useInboxNotifications';
import { useInboxPageState } from '@/lib/inbox/useInboxPageState';
import { useInboxQueries } from '@/lib/inbox/useInboxQueries';
import { useInboxRoleFlags } from '@/lib/inbox/useInboxRoleFlags';
import { useInboxSlaClock } from '@/lib/inbox/useInboxSLA';
import { useAuth } from '@/store/auth';

export function useInboxPageController() {
  const user = useAuth((s) => s.user);
  const isAuthenticated = useAuth((s) => s.isAuthenticated);
  const hasHydrated = useAuth((s) => s.hasHydrated);
  const canFetch = hasHydrated && isAuthenticated;
  const qc = useQueryClient();
  const { density: inboxDensity } = useInboxDensity();
  const aiRuntime = useMergedAiFeatures(canFetch);

  const roleName = String(user?.role || '').toLowerCase();
  const flags = useInboxRoleFlags(roleName);
  const state = useInboxPageState({ isSupervisor: flags.isSupervisor, roleName });

  const { selectedChannel, selectedChannelId } = useOperationalContext({
    enabled: canFetch,
    channelTypes: ['whatsapp', 'instagram', 'email', 'webchat'],
  });

  const { nowMinute, nowTick } = useInboxSlaClock();
  const layout = useInboxLayout(state.copilotOpen, state.copilotCollapsed);

  const queries = useInboxQueries({
    canFetch,
    userId: user?.id,
    canStartStaffConversation: flags.canStartStaffConversation,
    canDecideAdvance: flags.canDecideAdvance,
    canUseSlaAlerts: flags.canUseSlaAlerts,
    isSupervisor: flags.isSupervisor,
    isAdmin: flags.isAdmin,
    canFilterByAttendant: flags.canFilterByAttendant,
    isCommercialTeam: flags.isCommercialTeam,
    nowMinute,
    folder: state.folder,
    search: state.search,
    statusFilter: state.statusFilter,
    priorityFilter: state.priorityFilter,
    channelFilter: state.channelFilter,
    favorites: state.favorites,
    activeId: state.activeId,
    setActiveId: state.setActiveId,
    supervisorMainTab: state.supervisorMainTab,
    supervisorAttendantId: state.supervisorAttendantId,
    supervisorAttendanceGroup: state.supervisorAttendanceGroup,
    supervisorSlaStage: state.supervisorSlaStage,
    supervisorSlaBucket: state.supervisorSlaBucket,
    sectorFilterId: state.sectorFilterId,
    supervisorTaskStatus: state.supervisorTaskStatus,
    supervisorTaskType: state.supervisorTaskType,
    supervisorTicketStatus: state.supervisorTicketStatus,
    selectedChannel,
    selectedChannelId,
    transferOpen: state.transferOpen,
    showNewConversation: state.showNewConversation,
    noteOpen: state.noteOpen,
    noteText: state.noteText,
    noteCaret: state.noteCaret,
    advanceEntryDrawerOpen: state.advanceEntryDrawerOpen,
    advanceEntryTaskId: state.advanceEntryTaskId,
  });

  const notifications = useInboxNotifications({
    canFetch,
    userId: user?.id,
    canStartStaffConversation: flags.canStartStaffConversation,
    canUseSlaAlerts: flags.canUseSlaAlerts,
    isSupervisor: flags.isSupervisor,
    setFolder: state.setFolder,
    setActiveId: state.setActiveId,
  });

  const folders = useMemo(
    () =>
      queries.folders.map((row) =>
        row.key === 'pending_tasks' ? { ...row, count: notifications.unreadCount } : row
      ),
    [notifications.unreadCount, queries.folders]
  );

  const refetchInboxThread = useCallback(
    () => Promise.all([queries.refetchConvs(), queries.refetchDetail()]),
    [queries.refetchConvs, queries.refetchDetail]
  );

  const derived = useInboxDerived({
    detail: queries.detail,
    active: queries.active,
    activeId: state.activeId,
    favorites: state.favorites,
    contact: queries.contact,
    nowTick,
  });

  const composer = useInboxComposer({
    activeId: state.activeId,
    selectedChannelId,
    chatSignatureEnabled: queries.chatSignatureEnabled,
    signatureName: user?.name,
    refetchAfterMutation: refetchInboxThread,
    whatsappWindowOpen: derived.whatsappWindowOpen,
    templates: queries.templatesData ?? [],
  });

  const actions = useInboxActions({
    activeId: state.activeId,
    userId: user?.id,
    convQuery: queries.convQuery,
    detail: queries.detail,
    activeRaw: queries.active?.raw,
    displayName: derived.displayName,
    currentStatus: derived.currentStatus,
    roleName,
    contactId: queries.contactId,
    isSending: composer.isSending,
    setIsSending: composer.setIsSending,
    setSendError: composer.setSendError,
    refetchConvs: queries.refetchConvs,
    refetchDetail: queries.refetchDetail,
    qc,
    favorites: state.favorites,
    persistFavorites: state.persistFavorites,
    transferOpen: state.transferOpen,
    setTransferOpen: state.setTransferOpen,
    onAdvanceApprovedEntry: state.openAdvanceEntry,
  });

  const onConversationCreated = useCallback(
    (id: string) => {
      state.setActiveId(id);
      state.setFolder('mine');
      void queries.refetchConvs();
    },
    [queries.refetchConvs, state]
  );

  const onAdvanceEntryDone = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['inbox', 'advance-task'] });
    void qc.invalidateQueries({ queryKey: ['inbox', 'tasks-summary'] });
    if (state.advanceEntryTaskId) {
      void qc.invalidateQueries({ queryKey: ['inbox', 'task-context', state.advanceEntryTaskId] });
    }
  }, [qc, state.advanceEntryTaskId]);

  const onSubmitNote = useCallback(() => {
    void actions.submitNote(state.noteText, (hint) => {
      state.setNoteText('');
      state.setNoteOpen(false);
      state.setNoteHint(hint);
    });
  }, [actions, state]);

  const onRejectAdvance = useCallback(
    (taskId: string) => {
      const reason = window.prompt('Informe o motivo da reprovação:');
      if (!reason?.trim()) return;
      void actions.decideTask(taskId, 'rejected', reason.trim());
    },
    [actions]
  );

  return {
    inboxDensity,
    aiRuntime,
    flags,
    state,
    layout,
    queries: { ...queries, folders },
    composer,
    derived,
    actions,
    nowTick,
    notifications,
    onConversationCreated,
    onAdvanceEntryDone,
    onSubmitNote,
    onRejectAdvance,
    selectedChannelId,
  };
}

export type InboxPageController = ReturnType<typeof useInboxPageController>;
