import { useEffect, useMemo, useState } from 'react';
import { inboxPriorityLabel, inboxPriorityUi, inboxSlaCountdown } from '@/lib/inbox/inboxSla';
import type { ApiConversation, ApiConversationDetail, ApiConversationPriority } from '@/lib/inbox/types';

export function useInboxSlaClock() {
  const [nowMinute, setNowMinute] = useState(() => Date.now());
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const t1 = setInterval(() => setNowMinute(Date.now()), 60_000);
    const t2 = setInterval(() => setNowTick(Date.now()), 1_000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
    };
  }, []);

  return { nowMinute, nowTick };
}

export function useInboxSlaMeta(
  detail: ApiConversationDetail | undefined,
  activeRaw: ApiConversation | undefined,
  nowTick: number
) {
  const currentPriority = useMemo(
    () => (detail?.priority || activeRaw?.priority || 'normal') as ApiConversationPriority,
    [detail?.priority, activeRaw?.priority]
  );

  const priorityLabel = useMemo(
    () => inboxPriorityLabel(detail?.priority || activeRaw?.priority),
    [detail?.priority, activeRaw?.priority]
  );

  const priorityUi = useMemo(() => inboxPriorityUi(currentPriority), [currentPriority]);

  const slaCountdown = useMemo(
    () => inboxSlaCountdown(detail, activeRaw, nowTick),
    [detail, activeRaw, nowTick]
  );

  return { currentPriority, priorityLabel, priorityUi, slaCountdown };
}
