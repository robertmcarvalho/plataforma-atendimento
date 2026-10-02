'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatInboxNotificationWhen, type InboxNotificationItem } from '@/lib/inbox/inboxNotificationsFeed';
import { cn } from '@/lib/utils';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: InboxNotificationItem[];
  unreadCount: number;
  onMarkAllRead: () => void;
  onSelectItem: (item: InboxNotificationItem) => void;
  onGoToOperacaoAll: () => void;
  disabled?: boolean;
};

export function InboxNotificationsPopover({
  open,
  onOpenChange,
  items,
  unreadCount,
  onMarkAllRead,
  onSelectItem,
  onGoToOperacaoAll,
  disabled,
}: Props) {
  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={disabled}
      className="relative text-muted-foreground"
      title="Notificações e pendências"
      aria-label="Notificações"
    >
      <Bell className="h-3.5 w-3.5 shrink-0" />
      {unreadCount > 0 ? (
        <span className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-0.5 text-[9px] font-bold leading-none text-destructive-foreground">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      ) : null}
    </Button>
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={trigger} />

      <PopoverContent align="end" side="bottom" sideOffset={8} className="w-[min(22rem,calc(100vw-1.5rem))] gap-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Notificações</h3>
          {items.length > 0 ? (
            <button
              type="button"
              onClick={onMarkAllRead}
              className="text-xs font-medium text-primary hover:underline"
            >
              Marcar todas como lidas
            </button>
          ) : null}
        </div>

        <div className="max-h-80 overflow-y-auto overscroll-contain">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">Nenhuma notificação no momento.</div>
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onSelectItem(item)}
                    className={cn(
                      'flex w-full gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-sidebar-accent/50',
                      item.unread && 'bg-primary/5'
                    )}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                      {item.actorInitials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold text-foreground">{item.actorName}</div>
                      <div className="mt-0.5 line-clamp-2 text-xs text-foreground/90">{item.summary}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">{formatInboxNotificationWhen(item.at)}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 ? (
          <div className="border-t border-border px-4 py-2.5">
            <Link
              href="/operacao"
              onClick={(e) => {
                e.preventDefault();
                onGoToOperacaoAll();
              }}
              className="text-xs font-medium text-primary hover:underline"
            >
              Ver todas em Operação →
            </Link>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
