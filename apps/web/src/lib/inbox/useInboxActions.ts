import { useCallback, useEffect, useMemo, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { apiErrorMessage, apiErrorPayload } from '@/lib/apiErrorMessage';
import axios from 'axios';
import { buildNewContactBody } from '@/lib/inbox/inboxFormatters';
import type { ApiConversation, ApiConversationDetail, ApiConversationPriority, ApiConversationStatus } from '@/lib/inbox/types';
import { normalizeBrazilPhone } from '@/lib/brFormat';

type UseInboxActionsOptions = {
  activeId: string;
  userId?: string;
  convQuery: string;
  detail?: ApiConversationDetail;
  activeRaw?: ApiConversation;
  displayName: string;
  currentStatus: ApiConversationStatus;
  roleName: string;
  contactId: string | null;
  isSending: boolean;
  setIsSending: (busy: boolean) => void;
  setSendError: (message: string | null) => void;
  refetchConvs: () => Promise<unknown>;
  refetchDetail: () => Promise<unknown>;
  qc: QueryClient;
  favorites: Record<string, true>;
  persistFavorites: (next: Record<string, true>) => void;
  onAdvanceApprovedEntry: (taskId: string) => void;
  transferOpen?: boolean;
  setTransferOpen?: (open: boolean) => void;
};

export function useInboxActions({
  activeId,
  userId,
  convQuery,
  detail,
  activeRaw,
  displayName,
  currentStatus,
  roleName,
  contactId,
  isSending,
  setIsSending,
  setSendError,
  refetchConvs,
  refetchDetail,
  qc,
  favorites,
  persistFavorites,
  onAdvanceApprovedEntry,
  transferOpen: transferOpenProp,
  setTransferOpen: setTransferOpenProp,
}: UseInboxActionsOptions) {
  const [transferOpenInternal, setTransferOpenInternal] = useState(false);
  const transferOpen = transferOpenProp ?? transferOpenInternal;
  const setTransferOpen = setTransferOpenProp ?? setTransferOpenInternal;
  const [transferSectorId, setTransferSectorId] = useState('');
  const [transferAttendantId, setTransferAttendantId] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [advanceDecideBusy, setAdvanceDecideBusy] = useState(false);
  const [saveContactBusy, setSaveContactBusy] = useState(false);
  const [saveContactHint, setSaveContactHint] = useState<string | null>(null);
  const [saveContactDuplicateId, setSaveContactDuplicateId] = useState<string | null>(null);

  useEffect(() => {
    setSaveContactHint(null);
    setSaveContactDuplicateId(null);
  }, [activeId]);

  useEffect(() => {
    if (!transferOpen) return;
    setTransferAttendantId('');
  }, [transferSectorId, transferOpen]);

  const refetchThread = useCallback(
    () => Promise.all([refetchConvs(), refetchDetail()]),
    [refetchConvs, refetchDetail]
  );

  const withSending = useCallback(
    async (fn: () => Promise<void>, fallbackError: string) => {
      if (!activeId || isSending) return;
      setIsSending(true);
      setSendError(null);
      try {
        await fn();
      } catch (e: unknown) {
        setSendError(apiErrorMessage(e, fallbackError));
      } finally {
        setIsSending(false);
      }
    },
    [activeId, isSending, setIsSending, setSendError]
  );

  const onResolve = useCallback(
    () =>
      withSending(async () => {
        await api.patch(`/api/conversations/${activeId}`, { status: 'resolved' });
        await refetchThread();
      }, 'Não foi possível resolver a conversa.'),
    [activeId, refetchThread, withSending]
  );

  const toggleFavorite = useCallback(() => {
    if (!activeId) return;
    const next = { ...favorites };
    if (next[activeId]) delete next[activeId];
    else next[activeId] = true;
    persistFavorites(next);
  }, [activeId, favorites, persistFavorites]);

  const patchConversationTags = useCallback(
    async (next: string[]) => {
      await withSending(async () => {
        await api.patch(`/api/conversations/${activeId}`, { tags: next });
        await refetchThread();
      }, 'Falha ao atualizar tags.');
    },
    [activeId, refetchThread, withSending]
  );

  const addTagBySlug = useCallback(
    async (slug: string, onPicked?: () => void) => {
      if (!activeId || isSending || !slug) return;
      const current = (detail?.tags || activeRaw?.tags || []).filter(Boolean) as string[];
      const next = Array.from(new Set([...current, slug]));
      onPicked?.();
      await patchConversationTags(next);
    },
    [activeId, activeRaw?.tags, detail?.tags, isSending, patchConversationTags]
  );

  const removeTagBySlug = useCallback(
    async (slug: string) => {
      if (!activeId || isSending || !slug) return;
      const current = (detail?.tags || activeRaw?.tags || []).filter(Boolean) as string[];
      await patchConversationTags(current.filter((t) => t !== slug));
    },
    [activeId, activeRaw?.tags, detail?.tags, isSending, patchConversationTags]
  );

  const decideTask = useCallback(
    async (taskId: string, decision: 'approved' | 'rejected', reason?: string) => {
      setAdvanceDecideBusy(true);
      try {
        const payload = decision === 'rejected' ? { decision, reason } : { decision };
        const { data } = await api.patch(`/api/tasks/${taskId}/decision`, payload);
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['inbox', 'tasks-summary'] }),
          qc.invalidateQueries({ queryKey: ['inbox', 'advance-task'] }),
          qc.invalidateQueries({ queryKey: ['inbox', 'task-context', taskId] }),
        ]);
        if (decision === 'approved' && data?.next_action?.type === 'inline_financial_entry') {
          onAdvanceApprovedEntry(taskId);
        }
      } catch (e: unknown) {
        setSendError(apiErrorMessage(e, 'Falha ao processar decisão de adiantamento.'));
      } finally {
        setAdvanceDecideBusy(false);
      }
    },
    [onAdvanceApprovedEntry, qc, setSendError]
  );

  const assignToMe = useCallback(
    () => {
      if (!userId) return;
      return withSending(async () => {
        await api.post(`/api/conversations/${activeId}/assign`, { attendant_id: userId });
        await refetchThread();
      }, 'Falha ao assumir conversa.');
    },
    [activeId, refetchThread, userId, withSending]
  );

  const reopen = useCallback(
    () =>
      withSending(async () => {
        await api.patch(`/api/conversations/${activeId}/reopen`);
        await refetchThread();
      }, 'Falha ao reabrir conversa.'),
    [activeId, refetchThread, withSending]
  );

  const submitNote = useCallback(
    async (content: string, onSaved: (hint: string) => void) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      await withSending(async () => {
        const { data } = await api.post<{
          side_effects?: { mentions?: unknown[]; tasks_created?: unknown[] };
        }>(`/api/conversations/${activeId}/notes`, { content: trimmed });
        const created =
          (data?.side_effects?.tasks_created?.length || 0) + (data?.side_effects?.mentions?.length || 0);
        onSaved(created > 0 ? `Nota salva. ${created} pendência(s) criada(s).` : 'Nota interna salva.');
        await Promise.all([
          refetchThread(),
          qc.invalidateQueries({ queryKey: ['inbox', 'my-open-tasks'] }),
        ]);
      }, 'Falha ao criar nota interna.');
    },
    [activeId, qc, refetchThread, withSending]
  );

  const openTransfer = useCallback(() => {
    setTransferSectorId(detail?.sectors?.id || activeRaw?.sectors?.id || '');
    setTransferAttendantId(detail?.attendant?.id || activeRaw?.attendant?.id || '');
    setTransferReason('');
    setTransferOpen(true);
  }, [activeRaw?.attendant?.id, activeRaw?.sectors?.id, detail?.attendant?.id, detail?.sectors?.id]);

  const submitTransfer = useCallback(async () => {
    const to_sector_id = transferSectorId || undefined;
    const to_attendant_id = transferAttendantId || undefined;
    const reason = transferReason.trim() || undefined;
    if (!to_sector_id && !to_attendant_id) return;

    await withSending(async () => {
      await api.post(`/api/conversations/${activeId}/transfer`, { to_sector_id, to_attendant_id, reason });
      setTransferOpen(false);
      await refetchThread();
    }, 'Falha ao transferir conversa.');
  }, [activeId, refetchThread, transferAttendantId, transferReason, transferSectorId, withSending]);

  const setPriority = useCallback(
    async (priority: ApiConversationPriority, onDone?: () => void) => {
      await withSending(async () => {
        await api.patch(`/api/conversations/${activeId}`, { priority });
        onDone?.();
        await refetchThread();
      }, 'Falha ao atualizar prioridade.');
    },
    [activeId, refetchThread, withSending]
  );

  const waNormalizedForSave = normalizeBrazilPhone(detail?.contacts?.wa_phone || activeRaw?.contacts?.wa_phone || '');
  const canManageContacts = roleName === 'admin' || roleName === 'supervisor' || roleName === 'operational';
  const showSaveToContacts = useMemo(
    () =>
      canManageContacts &&
      (currentStatus === 'open' || currentStatus === 'pending') &&
      Boolean(activeId) &&
      !contactId &&
      waNormalizedForSave.length >= 12,
    [activeId, canManageContacts, contactId, currentStatus, waNormalizedForSave.length]
  );

  const onSaveConversationContact = useCallback(async () => {
    if (!activeId || !showSaveToContacts) return;
    setSaveContactBusy(true);
    setSaveContactHint(null);
    setSaveContactDuplicateId(null);
    try {
      const body = buildNewContactBody(detail, displayName === '—' ? '' : displayName, waNormalizedForSave);
      const { data: created } = await api.post<{ id: string }>('/api/contacts', body);
      if (created?.id) {
        await api.patch(`/api/conversations/${activeId}`, {
          contact_id: created.id,
          merge_duplicate_open: true,
        });
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['inbox', 'conversation', activeId] }),
        qc.invalidateQueries({ queryKey: ['inbox', 'conversations', convQuery] }),
      ]);
      await refetchThread();
      setSaveContactHint('Contato salvo e vinculado a esta conversa.');
    } catch (e: unknown) {
      if (axios.isAxiosError(e) && e.response?.status === 409) {
        const payload = apiErrorPayload(e);
        setSaveContactDuplicateId(payload?.existing_contact_id || null);
        setSaveContactHint(apiErrorMessage(e, 'Telefone ja cadastrado.'));
      } else {
        setSaveContactHint(apiErrorMessage(e, 'Nao foi possivel salvar o contato.'));
      }
    } finally {
      setSaveContactBusy(false);
    }
  }, [
    activeId,
    convQuery,
    detail,
    displayName,
    qc,
    refetchThread,
    showSaveToContacts,
    waNormalizedForSave,
  ]);

  const onLinkConversationToExistingContact = useCallback(async () => {
    if (!activeId || !saveContactDuplicateId) return;
    setSaveContactBusy(true);
    try {
      await api.patch(`/api/conversations/${activeId}`, {
        contact_id: saveContactDuplicateId,
        merge_duplicate_open: true,
      });
      setSaveContactDuplicateId(null);
      setSaveContactHint('Conversa vinculada ao contato existente.');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['inbox', 'conversation', activeId] }),
        qc.invalidateQueries({ queryKey: ['inbox', 'conversations', convQuery] }),
      ]);
      await refetchThread();
    } catch (e: unknown) {
      setSaveContactHint(apiErrorMessage(e, 'Falha ao vincular.'));
    } finally {
      setSaveContactBusy(false);
    }
  }, [activeId, convQuery, qc, refetchThread, saveContactDuplicateId]);

  return {
    onResolve,
    toggleFavorite,
    addTagBySlug,
    removeTagBySlug,
    decideTask,
    assignToMe,
    reopen,
    submitNote,
    openTransfer,
    submitTransfer,
    setPriority,
    onSaveConversationContact,
    onLinkConversationToExistingContact,
    transferOpen,
    setTransferOpen,
    transferSectorId,
    setTransferSectorId,
    transferAttendantId,
    setTransferAttendantId,
    transferReason,
    setTransferReason,
    advanceDecideBusy,
    saveContactBusy,
    saveContactHint,
    saveContactDuplicateId,
    showSaveToContacts,
  };
}
