'use client';

import { useState } from 'react';
import { Filter, FolderOpen } from 'lucide-react';
import { InboxFilterForm } from '@/components/inbox/InboxFilterForm';
import { InboxNotificationsPopover } from '@/components/inbox/InboxNotificationsPopover';
import { ChannelBadge, type Channel } from '@/components/ui/ChannelBadge';
import { FilterSheet } from '@/components/ui/FilterSheet';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { inboxChannels } from '@/lib/inbox/inboxChannels';
import { interactiveNavCount, interactiveNavItem } from '@/lib/interactiveRow';
import { cn } from '@/lib/utils';
import type { InboxFolderColumnProps } from '@/components/inbox/InboxFolderColumn';

/** Barra compacta de pastas/canais/filtros para inbox no mobile. */
export function InboxMobileFolderBar(props: InboxFolderColumnProps) {
  const {
    filterOpen,
    onToggleFilter,
    onCloseFilter,
    onClearFilters,
    folders,
    folder,
    onFolderSelect,
    channelFilter,
    onChannelFilterToggle,
    channelCounts,
    canStartStaffConversation,
    notifications,
  } = props;

  const [foldersOpen, setFoldersOpen] = useState(false);

  return (
    <>
      <div className="shrink-0 space-y-2 border-b border-border bg-surface px-3 py-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="max-lg:min-h-11 shrink-0 gap-1.5"
            onClick={() => setFoldersOpen(true)}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Pastas
          </Button>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <div className="flex w-max items-center gap-1.5 pr-1">
              {folders.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => onFolderSelect(f.key)}
                  data-testid={`inbox-folder-${f.key}`}
                  className={cn(
                    'inline-flex max-lg:min-h-11 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    f.key !== 'pending_tasks' && folder === f.key
                      ? 'border-primary/40 bg-primary/15 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span>{f.label}</span>
                  <span className="font-mono text-[10px] opacity-80">{f.count}</span>
                </button>
              ))}
            </div>
          </div>
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
      </div>

      <Sheet open={foldersOpen} onOpenChange={setFoldersOpen}>
        <SheetContent side="bottom" showCloseButton className="max-h-[min(85dvh,28rem)] rounded-t-2xl safe-area-bottom">
          <SheetHeader className="border-b border-border pb-3">
            <SheetTitle>Pastas e canais</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">Pastas</p>
            <div className="space-y-0.5">
              {folders.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => {
                    onFolderSelect(f.key);
                    setFoldersOpen(false);
                  }}
                  className={interactiveNavItem(f.key !== 'pending_tasks' && folder === f.key)}
                >
                  <span>{f.label}</span>
                  <span className={interactiveNavCount(f.key !== 'pending_tasks' && folder === f.key)}>{f.count}</span>
                </button>
              ))}
            </div>
            <p className="mb-2 mt-4 px-1 text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">Canais</p>
            <div className="space-y-0.5">
              {inboxChannels.map((ch) => (
                <button
                  key={ch}
                  type="button"
                  onClick={() => onChannelFilterToggle(ch as Channel)}
                  className={interactiveNavItem(channelFilter === ch)}
                >
                  <ChannelBadge channel={ch} showLabel />
                  <span className={interactiveNavCount(channelFilter === ch)}>{channelCounts.get(ch) ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <FilterSheet
        open={filterOpen}
        onOpenChange={(open) => !open && onCloseFilter()}
        onClear={onClearFilters}
      >
        <InboxFilterForm {...props} />
      </FilterSheet>
    </>
  );
}
