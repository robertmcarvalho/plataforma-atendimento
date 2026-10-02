import { CheckCheck, Clock3, ShieldAlert, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  interactiveRowActiveBar,
  interactiveRowMuted,
  interactiveRowPrimary,
  interactiveRowSecondary,
  interactiveRowSurface,
  semanticPillClass,
} from '@/lib/interactiveRow';
import { cn } from '@/lib/utils';
import { ChannelBadge, type Channel } from './ChannelBadge';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'destructive';
type SlaKind = 'ok' | 'soon' | 'breach' | 'none';

export type ConversationItemModel = {
  id: string;
  avatar?: React.ReactNode;
  title: string;
  subtitle?: string | null;
  preview?: string | null;
  updatedLabel?: string | null;
  unread?: boolean;
  priorityLabel?: string | null;
  contextLabel?: string | null;
  ownerLabel?: string | null;
  channel?: Channel;
  sla?: {
    label: string;
    tone: Tone;
    kind: SlaKind;
  } | null;
};

function slaToneToPill(tone: Tone) {
  if (tone === 'primary') return semanticPillClass('primary', 'h-auto gap-1.5 px-2 py-1 text-[11px]');
  if (tone === 'success') return semanticPillClass('success', 'h-auto gap-1.5 px-2 py-1 text-[11px]');
  if (tone === 'warning') return semanticPillClass('warning', 'h-auto gap-1.5 px-2 py-1 text-[11px]');
  if (tone === 'destructive') return semanticPillClass('destructive', 'h-auto gap-1.5 px-2 py-1 text-[11px]');
  return semanticPillClass('neutral', 'h-auto gap-1.5 px-2 py-1 text-[11px]');
}

function SlaIcon({ kind }: { kind: SlaKind }) {
  if (kind === 'ok') return <CheckCheck size={14} />;
  if (kind === 'soon') return <ShieldAlert size={14} />;
  if (kind === 'breach') return <AlertCircle size={14} />;
  return <Clock3 size={14} />;
}

export function ConversationItem({
  item,
  active,
  onSelect,
}: {
  item: ConversationItemModel;
  active: boolean;
  onSelect: () => void;
}) {
  const channel = item.channel || 'whatsapp';
  const sla = item.sla;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'relative flex w-full items-stretch gap-3 rounded-xl border border-border px-3 py-2 text-left duration-150 ease-snappy',
        interactiveRowSurface(active)
      )}
    >
      <span className={interactiveRowActiveBar(active)} aria-hidden="true" />

      {item.avatar ? (
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-elevated text-muted-foreground">
          {item.avatar}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className={cn('truncate text-[13px] font-semibold tracking-tight-2', interactiveRowPrimary(active))}>
                {item.title}
              </p>
              {item.unread ? (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="Nao lida" title="Nao lida" />
              ) : null}
            </div>
            {item.subtitle ? (
              <p className={cn('mono mt-0.5 truncate text-[11px]', interactiveRowSecondary(active))}>{item.subtitle}</p>
            ) : null}
          </div>

          <div className="flex flex-col items-end gap-1">
            <ChannelBadge channel={channel} size="sm" className="hidden md:inline-flex" />
            {item.updatedLabel ? (
              <span className={cn('mono text-[10px]', interactiveRowMuted(active))}>{item.updatedLabel}</span>
            ) : null}
          </div>
        </div>

        {item.preview ? (
          <p className={cn('line-clamp-1 text-[12px]', active ? interactiveRowSecondary(true) : item.unread ? 'text-foreground' : interactiveRowSecondary(false))}>
            {item.preview}
          </p>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {sla ? (
            <Badge variant="outline" className={slaToneToPill(sla.tone)}>
              <SlaIcon kind={sla.kind} />
              <span className="hidden sm:inline">{sla.label}</span>
              <span className="sm:hidden">SLA</span>
            </Badge>
          ) : null}

          {item.priorityLabel ? (
            <Badge variant="outline" className={semanticPillClass('neutral', 'h-auto px-2 py-1 text-[11px]')}>
              {item.priorityLabel}
            </Badge>
          ) : null}
        </div>

        <div className={cn('mt-1 flex items-center justify-between gap-2 text-[11px]', interactiveRowSecondary(active))}>
          <span className="truncate">{item.contextLabel || 'Sem contexto'}</span>
          <span className="truncate">{item.ownerLabel || 'Sem dono'}</span>
        </div>
      </div>
    </button>
  );
}
