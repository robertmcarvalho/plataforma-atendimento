import { CheckCheck, Clock3, ShieldAlert, AlertCircle } from 'lucide-react';
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

function toneClasses(tone: Tone) {
  if (tone === 'primary') return 'border-primary/25 bg-primary/10 text-primary';
  if (tone === 'success') return 'border-success/25 bg-success/10 text-success';
  if (tone === 'warning') return 'border-warning/25 bg-warning/10 text-warning';
  if (tone === 'destructive') return 'border-destructive/25 bg-destructive/10 text-destructive';
  return 'border-border bg-surface text-muted-foreground';
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
  const base =
    'group relative flex w-full items-stretch gap-3 rounded-xl border px-3 py-2 text-left transition-colors duration-150 ease-snappy';
  const bg = active
    ? 'border-primary/30 bg-surface-elevated'
    : 'border-border bg-surface hover:bg-surface-hover';

  return (
    <button type="button" onClick={onSelect} className={`${base} ${bg}`}>
      <span
        className={`absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r ${
          active ? 'bg-primary' : 'bg-transparent'
        }`}
        aria-hidden="true"
      />

      {item.avatar ? (
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground">
          {item.avatar}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p
                className={`truncate text-[13px] font-semibold tracking-tight-2 ${
                  item.unread ? 'text-foreground' : 'text-foreground'
                }`}
              >
                {item.title}
              </p>
              {item.unread ? (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                  aria-label="Nao lida"
                  title="Nao lida"
                />
              ) : null}
            </div>
            {item.subtitle ? (
              <p className="mono mt-0.5 truncate text-[11px] text-subtle-foreground">{item.subtitle}</p>
            ) : null}
          </div>

          <div className="flex flex-col items-end gap-1">
            <ChannelBadge channel={channel} size="sm" className="hidden md:inline-flex" />
            {item.updatedLabel ? (
              <span className="mono text-[10px] text-subtle-foreground">{item.updatedLabel}</span>
            ) : null}
          </div>
        </div>

        {item.preview ? (
          <p className={`line-clamp-1 text-[12px] ${item.unread ? 'text-foreground' : 'text-muted-foreground'}`}>
            {item.preview}
          </p>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {sla ? (
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-semibold tracking-tight ${toneClasses(sla.tone)}`}>
              <SlaIcon kind={sla.kind} />
              <span className="hidden sm:inline">{sla.label}</span>
              <span className="sm:hidden">SLA</span>
            </span>
          ) : null}

          {item.priorityLabel ? (
            <span className="inline-flex items-center rounded-full border border-border bg-surface px-2 py-1 text-[11px] font-semibold tracking-tight text-muted-foreground">
              {item.priorityLabel}
            </span>
          ) : null}
        </div>

        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-subtle-foreground">
          <span className="truncate">{item.contextLabel || 'Sem contexto'}</span>
          <span className="truncate">{item.ownerLabel || 'Sem dono'}</span>
        </div>
      </div>
    </button>
  );
}
