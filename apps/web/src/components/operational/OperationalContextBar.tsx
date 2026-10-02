'use client';

import { Building2, ChevronRight, Radio } from 'lucide-react';
import { ToolbarSelect } from '@/components/form/ToolbarSelect';
import { cn } from '@/lib/utils';
import { useOperationalContext } from '@/hooks/useOperationalContext';
import type { WorkspaceChannel } from '@/lib/integrations/channelsApi';

type Props = {
  className?: string;
  channelTypes?: WorkspaceChannel['channel_type'][];
  note?: string;
};

function typeLabel(type: WorkspaceChannel['channel_type']): string {
  if (type === 'whatsapp') return 'WhatsApp';
  if (type === 'instagram') return 'Instagram';
  if (type === 'email') return 'E-mail';
  if (type === 'webchat') return 'Webchat';
  return type.toUpperCase();
}

export function OperationalContextBar({ className, channelTypes, note }: Props) {
  const { workspaceName, channels, selectedChannel, selectedChannelId, setSelectedChannelId, isLoading } =
    useOperationalContext({ channelTypes });

  const operationLabel = selectedChannel ? selectedChannel.operation_label : 'Todas as operações';

  return (
    <div
      className={cn(
        'flex min-h-10 flex-wrap items-center justify-between gap-2 border-b border-border bg-card/70 px-4 py-2 text-xs',
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-success shadow-[0_0_0_3px_rgba(34,197,94,0.12)]" />
        <span className="inline-flex items-center gap-1 font-medium text-foreground">
          <Building2 className="h-3.5 w-3.5 text-primary" />
          Operando em:
        </span>
        <span className="truncate">{workspaceName}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-subtle-foreground" />
        <span className="truncate font-medium text-foreground">{operationLabel}</span>
        {selectedChannel ? (
          <span className="rounded-md border border-border bg-background/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {typeLabel(selectedChannel.channel_type)}
          </span>
        ) : null}
        {note ? <span className="hidden text-[11px] text-subtle-foreground md:inline">{note}</span> : null}
      </div>

      <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <Radio className="h-3.5 w-3.5 text-primary" />
        <span>trocar</span>
        <ToolbarSelect
          value={selectedChannelId || ''}
          onChange={(v) => setSelectedChannelId(v || null)}
          disabled={isLoading}
          aria-label="Trocar operação"
          className="text-[11px]"
          options={[
            { value: '', label: 'Todas as operações' },
            ...channels.map((ch) => ({
              value: ch.id,
              label: `${ch.operation_label} · ${typeLabel(ch.channel_type)}`,
            })),
          ]}
        />
      </label>
    </div>
  );
}
