'use client';

import {
  getConversationSlaListBadgeState,
  type AttendanceSlaStageDetail,
} from '@/components/inbox/InboxAttendanceSlaStages';
import { cn } from '@/lib/utils';

export function ConversationSlaListBadge({
  conv,
  nowMs,
}: {
  conv: AttendanceSlaStageDetail | null | undefined;
  nowMs: number;
}) {
  const state = getConversationSlaListBadgeState(conv, nowMs);
  if (!state) return null;
  return (
    <span className={cn(state.className)} title={state.title}>
      {state.label}
    </span>
  );
}
