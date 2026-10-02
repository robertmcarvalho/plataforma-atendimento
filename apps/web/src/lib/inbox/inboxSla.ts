import { pickActiveSlaDeadlineForCountdown } from '@/components/inbox/InboxAttendanceSlaStages';
import { formatCountdown } from '@/lib/inbox/inboxFormatters';
import type { ApiConversation, ApiConversationDetail, ApiConversationPriority } from '@/lib/inbox/types';

export function inboxPriorityLabel(priority: ApiConversationPriority | undefined | null): string {
  if (!priority || priority === 'normal') return 'Normal';
  if (priority === 'urgent') return 'Urgente';
  if (priority === 'high') return 'Alta';
  if (priority === 'low') return 'Baixa';
  return 'Normal';
}

export function inboxPriorityUi(currentPriority: ApiConversationPriority) {
  if (currentPriority === 'urgent') {
    return {
      pill: 'bg-destructive/15 text-destructive border border-destructive/25 animate-pulse',
      sla: 'text-destructive',
    };
  }
  if (currentPriority === 'high') {
    return {
      pill: 'bg-warning/15 text-warning border border-warning/25 animate-pulse',
      sla: 'text-warning',
    };
  }
  if (currentPriority === 'low') {
    return {
      pill: 'bg-success/15 text-success border border-success/25',
      sla: 'text-success',
    };
  }
  return {
    pill: 'bg-success/15 text-success border border-success/25',
    sla: 'text-success',
  };
}

export function inboxSlaCountdown(
  detail: ApiConversationDetail | undefined,
  activeRaw: ApiConversation | undefined,
  nowTick: number
): string {
  const merged = (detail || activeRaw) as (ApiConversationDetail & { sla_first_response_at?: string | null }) | undefined;
  const activeDeadline =
    pickActiveSlaDeadlineForCountdown(merged, nowTick) ?? merged?.sla_resolution_deadline ?? null;
  return formatCountdown(activeDeadline, nowTick);
}
