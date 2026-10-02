'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { interactiveNavItem } from '@/lib/interactiveRow';
import { cn } from '@/lib/utils';
import { useOperationalContext } from '@/hooks/useOperationalContext';
import type { WorkspaceChannel } from '@/lib/integrations/channelsApi';
import { Button } from '@/components/ui/button';
import { WorkspaceSwitcher } from '@/components/shell/WorkspaceSwitcher';

function typeLabel(type: WorkspaceChannel['channel_type']): string {
  if (type === 'whatsapp') return 'WhatsApp';
  if (type === 'instagram') return 'Instagram';
  if (type === 'email') return 'E-mail';
  if (type === 'webchat') return 'Webchat';
  return type.toUpperCase();
}

export function OperationalSessionHeader({ className }: { className?: string }) {
  const { channels, selectedChannel, selectedChannelId, setSelectedChannelId, isLoading, workspaceName } =
    useOperationalContext({});
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  const channelLabel = selectedChannel
    ? `${selectedChannel.operation_label} · ${typeLabel(selectedChannel.channel_type)}`
    : `${workspaceName || 'Workspace'} · Todas`;

  return (
    <div
      className={cn(
        'flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 py-2',
        className
      )}
    >
      <WorkspaceSwitcher variant="pill" />
      <div className="relative" ref={ref}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isLoading}
          onClick={() => setOpen((v) => !v)}
          className="h-auto max-w-[min(100%,20rem)] rounded-full px-3 py-1.5 text-xs font-medium"
        >
          <span className="truncate">{channelLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
        {open ? (
          <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-xl border border-border bg-popover p-1 shadow-md">
            <button
              type="button"
              className={cn(interactiveNavItem(false), 'justify-start rounded-lg px-3 py-2 text-left')}
              onClick={() => {
                setSelectedChannelId(null);
                setOpen(false);
              }}
            >
              Todas as operações
            </button>
            {channels.map((ch) => (
              <button
                key={ch.id}
                type="button"
                className={cn(
                  interactiveNavItem(selectedChannelId === ch.id),
                  'flex-col items-start justify-start rounded-lg px-3 py-2 text-left'
                )}
                onClick={() => {
                  setSelectedChannelId(ch.id);
                  setOpen(false);
                }}
              >
                <span className="font-medium">{ch.operation_label}</span>
                <span className="text-[10px] text-muted-foreground">{typeLabel(ch.channel_type)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
