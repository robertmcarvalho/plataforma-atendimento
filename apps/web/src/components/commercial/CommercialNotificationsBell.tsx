'use client';

import { useState } from 'react';
import { Bell } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  useCommercialNotifications,
  useMarkAllCommercialNotificationsRead,
  useMarkCommercialNotificationRead,
} from '@/lib/commercial/useCommercialQueries';
import type { CommercialNotification } from '@/lib/commercial/types';
import { cn } from '@/lib/utils';

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function CommercialNotificationsBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data } = useCommercialNotifications();
  const markRead = useMarkCommercialNotificationRead();
  const markAll = useMarkAllCommercialNotificationsRead();

  const items = data?.data ?? [];
  const unreadCount = data?.unread_count ?? 0;

  const handleSelect = async (item: CommercialNotification) => {
    if (!item.read_at) {
      await markRead.mutateAsync(item.id).catch(() => undefined);
    }
    setOpen(false);
    if (item.entity_type === 'commercial_leads' && item.entity_id) {
      router.push(`/commercial/leads/${item.entity_id}`);
    }
  };

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="relative text-muted-foreground"
      title="Notificações comerciais"
      aria-label="Notificações comerciais"
    >
      <Bell className="h-4 w-4" />
      {unreadCount > 0 ? (
        <span className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-0.5 text-[9px] font-bold leading-none text-destructive-foreground">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      ) : null}
    </Button>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="end" side="bottom" sideOffset={8} className="w-[min(22rem,calc(100vw-1.5rem))] gap-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Notificações</h3>
          {items.length > 0 ? (
            <button
              type="button"
              onClick={() => void markAll.mutateAsync()}
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
                    onClick={() => void handleSelect(item)}
                    className={cn(
                      'flex w-full flex-col gap-0.5 border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-sidebar-accent/50',
                      !item.read_at && 'bg-primary/5',
                    )}
                  >
                    <div className="text-xs font-semibold text-foreground">{item.title}</div>
                    {item.body ? <div className="line-clamp-2 text-xs text-foreground/90">{item.body}</div> : null}
                    <div className="text-[11px] text-muted-foreground">{formatWhen(item.created_at)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
