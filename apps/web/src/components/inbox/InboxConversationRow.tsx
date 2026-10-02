'use client';

import { ChannelBadge, type Channel } from '@/components/ui/ChannelBadge';
import { ConversationSlaListBadge } from '@/components/inbox/ConversationSlaListBadge';
import { SentimentBadge } from '@/components/inbox/ai/SentimentBadge';
import { UrgencyDot } from '@/components/inbox/ai/UrgencyBadge';
import { StatusDot } from '@/components/ui/StatusDot';
import {
  interactiveRowActiveBar,
  interactiveRowMuted,
  interactiveRowPrimary,
  interactiveRowSecondary,
  interactiveRowSurface,
  semanticPillClass,
  uiTagToneToPill,
} from '@/lib/interactiveRow';
import { cn } from '@/lib/utils';
type ApiConversationStatus = 'open' | 'pending' | 'resolved' | 'closed';
type ApiConversationPriority = 'low' | 'normal' | 'high' | 'urgent';

type ApiConversation = {
  id: string;
  status: ApiConversationStatus;
  priority: ApiConversationPriority;
  attendant?: { name?: string | null } | null;
  sla_first_response_deadline?: string | null;
  sla_resolution_deadline?: string | null;
  [key: string]: unknown;
};

type UiPresence = 'online' | 'idle' | 'offline' | 'busy';
type UiTagTone = 'warning' | 'success' | 'primary';

export type InboxConversationRowModel = {
  id: string;
  name: string;
  channel: Channel;
  preview: string;
  time: string;
  unread?: number;
  status: UiPresence;
  tag?: { label: string; tone: UiTagTone };
  duplicateThreadCount?: number;
  raw: ApiConversation;
};

function priorityPillClass(priority: ApiConversationPriority | null | undefined) {
  const p = (priority || 'normal') as ApiConversationPriority;
  if (p === 'urgent') return semanticPillClass('destructive', 'inbox-t-meta animate-pulse');
  if (p === 'high') return semanticPillClass('warning', 'inbox-t-meta animate-pulse');
  if (p === 'low') return semanticPillClass('success', 'inbox-t-meta');
  return semanticPillClass('success', 'inbox-t-meta');
}

function priorityLabel(priority: ApiConversationPriority | null | undefined) {
  const p = (priority || 'normal') as ApiConversationPriority;
  if (p === 'urgent') return 'Urgente';
  if (p === 'high') return 'Alta';
  if (p === 'low') return 'Baixa';
  return 'Normal';
}

function conversationAttendanceLabelPt(status: ApiConversationStatus): string {
  const m: Record<ApiConversationStatus, string> = {
    open: 'Em andamento',
    pending: 'Aguardando cliente',
    resolved: 'Finalizado',
    closed: 'Encerrado',
  };
  return m[status] || status;
}

export function InboxConversationRow({
  conversation: c,
  active,
  isSupervisor,
  showAiSentiment,
  showAiUrgency,
  listAi,
  nowMs,
  onSelect,
}: {
  conversation: InboxConversationRowModel;
  active: boolean;
  isSupervisor: boolean;
  showAiSentiment: boolean;
  showAiUrgency: boolean;
  listAi: { sentiment: string | null; urgency: string | null };
  nowMs: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`inbox-conversation-${c.id}`}
      className={cn(
        'relative flex w-full gap-3 border-b border-border/60 px-4 py-3 text-left',
        interactiveRowSurface(active)
      )}
    >
      <span className={interactiveRowActiveBar(active)} aria-hidden />

      <div className="relative shrink-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-muted to-muted/60 text-xs font-semibold text-foreground">
          {(c.name || '??')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase())
            .join('') || '??'}
        </div>
        <StatusDot status={c.status} className="absolute -bottom-0.5 -right-0.5" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate text-sm font-medium', interactiveRowPrimary(active), c.unread && !active && 'text-foreground')}>
            {c.name}
            {(c.duplicateThreadCount || 0) > 1 ? (
              <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                +{c.duplicateThreadCount! - 1}
              </span>
            ) : null}
          </span>
          <span
            className={cn(
              'shrink-0 font-mono inbox-t-meta',
              active ? 'text-sidebar-accent-foreground/80' : c.unread ? 'text-primary' : interactiveRowMuted(active)
            )}
          >
            {c.time}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <ChannelBadge channel={c.channel} />
          {showAiSentiment && listAi.sentiment ? <SentimentBadge sentiment={listAi.sentiment} /> : null}
          {showAiUrgency && listAi.urgency ? <UrgencyDot urgency={listAi.urgency} /> : null}
          <p
            className={cn(
              'min-w-0 flex-1 truncate text-xs',
              active ? interactiveRowSecondary(true) : c.unread ? 'text-foreground/80' : interactiveRowSecondary(false)
            )}
          >
            {c.preview}
          </p>
        </div>
        {isSupervisor ? (
          <div className={cn('mt-0.5 flex flex-wrap items-center gap-1 text-[9px]', interactiveRowSecondary(active))}>
            <span className={semanticPillClass('neutral', 'inbox-t-meta')}>
              {conversationAttendanceLabelPt(c.raw.status)}
            </span>
            {c.raw.attendant?.name ? (
              <span className="truncate">· {c.raw.attendant.name}</span>
            ) : (
              <span>· sem atendente</span>
            )}
          </div>
        ) : null}
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className={priorityPillClass(c.raw.priority)}>{priorityLabel(c.raw.priority)}</span>
          <ConversationSlaListBadge conv={c.raw} nowMs={nowMs} />
          {c.tag ? (
            <span className={uiTagToneToPill(c.tag.tone, 'inbox-t-meta')}>{c.tag.label}</span>
          ) : null}
          {c.unread ? (
            <span className="ml-auto rounded-full bg-primary px-1.5 py-0.5 font-mono inbox-t-meta font-semibold text-primary-foreground">
              {c.unread}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}
