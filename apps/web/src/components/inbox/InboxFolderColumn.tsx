'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Filter, Sparkles, X } from 'lucide-react';
import { InboxFilterForm, inboxFilterChipLabels } from '@/components/inbox/InboxFilterForm';
import { InboxNotificationsPopover } from '@/components/inbox/InboxNotificationsPopover';
import { ChannelBadge, type Channel } from '@/components/ui/ChannelBadge';
import { FilterSheet } from '@/components/ui/FilterSheet';
import { Button } from '@/components/ui/button';
import { features } from '@/lib/features';
import { inboxChannels } from '@/lib/inbox/inboxChannels';
import { INBOX_COLUMN_HEADER_CLASS } from '@/lib/inbox/inboxColumnHeader';
import { hasExplicitInboxFilters } from '@/lib/inbox/inboxListFilters';
import { isPortaledOverlayTarget, hasOpenPortaledSelect } from '@/lib/form/portaledOverlay';
import { useIsLgUp } from '@/hooks/useMediaQuery';
import type { useInboxNotifications } from '@/lib/inbox/useInboxNotifications';
import { interactiveNavCount, interactiveNavItem } from '@/lib/interactiveRow';
import type {
  ApiConversationPriority,
  ApiConversationStatus,
  ApiUser,
  FolderKey,
} from '@/lib/inbox/types';

type FolderRow = { key: FolderKey; label: string; count: number };

export type InboxFolderColumnProps = {
  filterOpen: boolean;
  onToggleFilter: () => void;
  onCloseFilter: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: 'all' | ApiConversationStatus;
  onStatusFilterChange: (value: 'all' | ApiConversationStatus) => void;
  priorityFilter: 'all' | ApiConversationPriority;
  onPriorityFilterChange: (value: 'all' | ApiConversationPriority) => void;
  isSupervisor: boolean;
  canFilterByAttendant: boolean;
  supervisorAttendantId: string;
  onSupervisorAttendantIdChange: (value: string) => void;
  supervisorAttendants: ApiUser[];
  teamPresence?: {
    members: Array<{ user_id: string; name: string; presence: 'online' | 'idle' | 'offline' }>;
    online_count: number;
    idle_count: number;
    total: number;
  } | null;
  supervisorAttendanceGroup: 'all' | 'active' | 'waiting' | 'finished';
  onSupervisorAttendanceGroupChange: (value: 'all' | 'active' | 'waiting' | 'finished') => void;
  supervisorSlaStage: '' | 'first_response' | 'treatment' | 'resolution';
  onSupervisorSlaStageChange: (value: '' | 'first_response' | 'treatment' | 'resolution') => void;
  supervisorSlaBucket: '' | 'breached' | 'at_risk' | 'on_track';
  onSupervisorSlaBucketChange: (value: '' | 'breached' | 'at_risk' | 'on_track') => void;
  sectorFilterId: string;
  onSectorFilterIdChange: (value: string) => void;
  sectors: Array<{ id: string; name: string }>;
  onClearFilters: () => void;
  folders: FolderRow[];
  folder: FolderKey;
  onFolderSelect: (key: FolderKey) => void;
  channelFilter: 'all' | Channel;
  onChannelFilterToggle: (channel: Channel) => void;
  channelCounts: Map<Channel, number>;
  canStartStaffConversation: boolean;
  notifications: ReturnType<typeof useInboxNotifications>;
};

export function InboxFolderColumn({
  filterOpen,
  onToggleFilter,
  onCloseFilter,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  isSupervisor,
  canFilterByAttendant,
  supervisorAttendantId,
  onSupervisorAttendantIdChange,
  supervisorAttendants,
  teamPresence,
  supervisorAttendanceGroup,
  onSupervisorAttendanceGroupChange,
  supervisorSlaStage,
  onSupervisorSlaStageChange,
  supervisorSlaBucket,
  onSupervisorSlaBucketChange,
  sectorFilterId,
  onSectorFilterIdChange,
  sectors,
  onClearFilters,
  folders,
  folder,
  onFolderSelect,
  channelFilter,
  onChannelFilterToggle,
  channelCounts,
  canStartStaffConversation,
  notifications,
}: InboxFolderColumnProps) {
  const filterPanelRef = useRef<HTMLDivElement | null>(null);
  const isLgUp = useIsLgUp();

  const activeFilterChips = useMemo(
    () =>
      inboxFilterChipLabels({
        isSupervisor,
        statusFilter,
        priorityFilter,
        search,
        supervisorAttendantId,
        supervisorAttendants,
        supervisorAttendanceGroup,
        sectorFilterId,
        sectors,
      }),
    [isSupervisor, priorityFilter, search, sectorFilterId, sectors, statusFilter, supervisorAttendanceGroup, supervisorAttendantId, supervisorAttendants],
  );

  const showFilterChips = hasExplicitInboxFilters({
    statusFilter,
    priorityFilter,
    search,
    attendantFilterId: supervisorAttendantId,
    sectorFilterId,
    supervisorAttendanceGroup: isSupervisor ? supervisorAttendanceGroup : 'all',
  });

  useEffect(() => {
    if (!filterOpen || !isLgUp) return;
    const onMouseDown = (ev: MouseEvent) => {
      const target = ev.target as Node | null;
      if (!target || !filterPanelRef.current) return;
      if (isPortaledOverlayTarget(target)) return;
      if (hasOpenPortaledSelect()) return;
      if (!filterPanelRef.current.contains(target)) onCloseFilter();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [filterOpen, onCloseFilter, isLgUp]);

  const filterFormProps = {
    filterOpen,
    onToggleFilter,
    onCloseFilter,
    search,
    onSearchChange,
    statusFilter,
    onStatusFilterChange,
    priorityFilter,
    onPriorityFilterChange,
    isSupervisor,
    canFilterByAttendant,
    supervisorAttendantId,
    onSupervisorAttendantIdChange,
    supervisorAttendants,
    teamPresence,
    supervisorAttendanceGroup,
    onSupervisorAttendanceGroupChange,
    supervisorSlaStage,
    onSupervisorSlaStageChange,
    supervisorSlaBucket,
    onSupervisorSlaBucketChange,
    sectorFilterId,
    onSectorFilterIdChange,
    sectors,
    onClearFilters,
    folders,
    folder,
    onFolderSelect,
    channelFilter,
    onChannelFilterToggle,
    channelCounts,
    canStartStaffConversation,
    notifications,
  };

  return (
    <div className="relative flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border bg-surface">
      <div className={INBOX_COLUMN_HEADER_CLASS}>
        <h2 className="min-w-0 truncate text-sm font-semibold tracking-tight">Caixa de entrada</h2>
        <div className="flex shrink-0 items-center gap-0.5">
          {canStartStaffConversation ? (
            <InboxNotificationsPopover
              open={notifications.open}
              onOpenChange={notifications.setOpen}
              items={notifications.items}
              unreadCount={notifications.unreadCount}
              onMarkAllRead={notifications.markAllRead}
              onSelectItem={notifications.navigateToNotification}
              onGoToOperacaoAll={notifications.goToOperacaoAll}
            />
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onToggleFilter}
            className="text-muted-foreground"
            title="Filtros"
            data-testid="inbox-filter"
            aria-expanded={filterOpen}
          >
            <Filter className="h-3.5 w-3.5 shrink-0" />
          </Button>
        </div>
      </div>

      {showFilterChips ? (
        <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
          {activeFilterChips.map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
            >
              {chip}
            </span>
          ))}
        </div>
      ) : null}

      {filterOpen && isLgUp ? (
        <div
          ref={filterPanelRef}
          className="absolute left-3 right-3 top-14 z-30 max-h-[min(32rem,calc(100dvh-5rem))] overflow-y-auto rounded-xl border border-border bg-popover p-3 shadow-md"
        >
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-foreground">Filtros</div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onCloseFilter}
              className="text-muted-foreground"
              title="Fechar"
            >
              <X className="h-3.5 w-3.5 shrink-0" />
            </Button>
          </div>

          <div className="mt-2 space-y-2">
            <InboxFilterForm {...filterFormProps} />
            <div className="flex items-center justify-between pt-1">
              <button
                onClick={onClearFilters}
                className="inbox-t-control font-medium text-muted-foreground hover:text-foreground"
              >
                Limpar
              </button>
              <Button size="xs" className="inbox-t-control" onClick={onCloseFilter}>
                Fechar
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {!isLgUp ? (
        <FilterSheet open={filterOpen} onOpenChange={(open) => !open && onCloseFilter()} onClear={onClearFilters}>
          <InboxFilterForm {...filterFormProps} />
        </FilterSheet>
      ) : null}

      <div className="space-y-0.5 p-2">
        {folders.map((f) => (
          <button
            key={f.key}
            onClick={() => onFolderSelect(f.key)}
            data-testid={`inbox-folder-${f.key}`}
            className={interactiveNavItem(f.key !== 'pending_tasks' && folder === f.key)}
          >
            <span>{f.label}</span>
            <span className={interactiveNavCount(f.key !== 'pending_tasks' && folder === f.key)}>{f.count}</span>
          </button>
        ))}
      </div>

      <div className="px-3 pt-4 pb-2">
        <h3 className="px-1 inbox-t-meta font-semibold uppercase tracking-wider text-subtle-foreground">Canais</h3>
      </div>
      <div className="space-y-0.5 px-2">
        {inboxChannels.map((ch) => (
          <button
            key={ch}
            onClick={() => onChannelFilterToggle(ch)}
            className={interactiveNavItem(channelFilter === ch)}
          >
            <ChannelBadge channel={ch} showLabel />
            <span className={interactiveNavCount(channelFilter === ch)}>{channelCounts.get(ch) ?? 0}</span>
          </button>
        ))}
      </div>

      {features.aiSuggestions ? (
        <div className="mt-auto p-3">
          <div className="rounded-lg border border-border bg-background/40 p-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Sparkles className="h-3 w-3 text-primary" />
              IA Sugestões
            </div>
            <p className="mt-1 inbox-t-control leading-relaxed text-muted-foreground">
              3 conversas podem ser resolvidas com respostas prontas.
            </p>
            <button className="mt-2 inbox-t-control font-medium text-primary hover:underline">Ver sugestões →</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
