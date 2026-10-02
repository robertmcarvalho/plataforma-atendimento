'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import {
  buildInboxNotificationFeed,
  countUnreadNotifications,
  type InboxNotificationItem,
} from '@/lib/inbox/inboxNotificationsFeed';
import { readNotificationsSeenAt, writeNotificationsSeenAt } from '@/lib/inbox/inboxNotificationsStorage';
import { operacaoPendenciasHref } from '@/lib/operacao/operacaoPendenciasLink';
import type { ApiPendingTask, ApiSlaEventRow, FolderKey } from '@/lib/inbox/types';

type Options = {
  canFetch: boolean;
  userId?: string;
  canStartStaffConversation: boolean;
  canUseSlaAlerts: boolean;
  isSupervisor: boolean;
  setFolder: (folder: FolderKey) => void;
  setActiveId: (id: string) => void;
};

type InboxNotificationsState = {
  seen_at: string | null;
};

export function useInboxNotifications({
  canFetch,
  userId,
  canStartStaffConversation,
  canUseSlaAlerts,
  isSupervisor,
  setFolder,
  setActiveId,
}: Options) {
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [optimisticSeenAt, setOptimisticSeenAt] = useState<string | null>(null);

  const { data: notificationPrefs } = useQuery({
    queryKey: ['notification-preferences'],
    enabled: canFetch && canStartStaffConversation,
    staleTime: 60_000,
    queryFn: async () => (await api.get<Record<string, unknown>>('/api/users/me/notification-preferences')).data,
  });

  const { data: feedState } = useQuery({
    queryKey: ['inbox', 'notifications-seen-at', userId],
    enabled: canFetch && canStartStaffConversation && Boolean(userId),
    staleTime: 30_000,
    queryFn: async () =>
      (await api.get<InboxNotificationsState>('/api/users/me/inbox-notifications/state')).data,
  });

  const prefSlaInApp = notificationPrefs?.sla_warning !== false;
  const prefTasksInApp = notificationPrefs?.open_tasks_inbox !== false;

  const seenAt =
    optimisticSeenAt ?? feedState?.seen_at ?? (userId ? readNotificationsSeenAt(userId) : null);

  const { data: notificationTasks = [] } = useQuery({
    queryKey: ['inbox', 'notification-tasks'],
    enabled: canFetch && canStartStaffConversation && prefTasksInApp,
    staleTime: 25_000,
    refetchInterval: 45_000,
    queryFn: () =>
      api.get('/api/tasks?status=open&limit=25').then((r) => r.data as ApiPendingTask[]),
  });

  const { data: slaFeed = [] } = useQuery({
    queryKey: ['inbox', 'sla-feed'],
    enabled: canFetch && canUseSlaAlerts && prefSlaInApp,
    staleTime: 25_000,
    refetchInterval: 55_000,
    queryFn: () => api.get('/api/sla/events').then((r) => r.data as ApiSlaEventRow[]),
  });

  const items = useMemo(
    () =>
      buildInboxNotificationFeed(notificationTasks, slaFeed, {
        includeTasks: prefTasksInApp,
        includeSla: canUseSlaAlerts && prefSlaInApp,
        seenAt,
      }),
    [canUseSlaAlerts, notificationTasks, prefSlaInApp, prefTasksInApp, seenAt, slaFeed]
  );

  const unreadCount = useMemo(() => countUnreadNotifications(items), [items]);

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      const res = await api.patch<InboxNotificationsState>('/api/users/me/inbox-notifications/mark-all-read');
      return res.data;
    },
    onMutate: () => {
      const now = new Date().toISOString();
      setOptimisticSeenAt(now);
      writeNotificationsSeenAt(userId, now);
    },
    onSuccess: (data) => {
      const next = data.seen_at || new Date().toISOString();
      setOptimisticSeenAt(next);
      writeNotificationsSeenAt(userId, next);
      qc.setQueryData(['inbox', 'notifications-seen-at', userId], { seen_at: next });
    },
    onError: () => {
      setOptimisticSeenAt(null);
    },
  });

  const openNotifications = useCallback(() => setOpen(true), []);

  const markAllRead = useCallback(() => {
    markAllReadMutation.mutate();
  }, [markAllReadMutation]);

  const navigateToNotification = useCallback(
    (item: InboxNotificationItem) => {
      setOpen(false);

      if (item.kind === 'task') {
        if (item.taskType === 'internal_note_mention' && item.conversationId) {
          setFolder('mentions');
          setActiveId(item.conversationId);
          return;
        }
        if (item.taskId) {
          router.push(operacaoPendenciasHref(item.taskId));
          return;
        }
      }

      if (item.kind === 'sla' && item.conversationId) {
        setFolder(isSupervisor ? 'sector_all' : 'unassigned');
        setActiveId(item.conversationId);
      }
    },
    [isSupervisor, router, setActiveId, setFolder]
  );

  const goToOperacaoAll = useCallback(() => {
    setOpen(false);
    router.push('/operacao');
  }, [router]);

  return {
    open,
    setOpen,
    openNotifications,
    items,
    unreadCount,
    markAllRead,
    navigateToNotification,
    goToOperacaoAll,
  };
}
