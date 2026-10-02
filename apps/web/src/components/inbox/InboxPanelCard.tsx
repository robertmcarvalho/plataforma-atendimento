'use client';

import {
  InboxContextCard,
  inboxContextCardMetaClass,
  inboxContextCardTitleClass,
} from '@/components/inbox/InboxContextCard';
import { semanticPillClass } from '@/lib/interactiveRow';
import { cn } from '@/lib/utils';

export type InboxPanelBadgeTone = 'neutral' | 'primary' | 'success' | 'destructive';
export type InboxPanelProgressTone = 'neutral' | 'ok' | 'warn' | 'bad';

function clampPct(n: number) {
  return Math.max(0, Math.min(100, n));
}

function badgeClass(tone: InboxPanelBadgeTone) {
  if (tone === 'primary') return semanticPillClass('primary', 'text-[11px]');
  if (tone === 'success') return semanticPillClass('success', 'text-[11px]');
  if (tone === 'destructive') return semanticPillClass('destructive', 'text-[11px]');
  return semanticPillClass('neutral', 'text-[11px]');
}

function progressBarClass(tone: InboxPanelProgressTone) {
  if (tone === 'ok') return 'bg-emerald-500';
  if (tone === 'bad') return 'bg-destructive';
  if (tone === 'warn') return 'bg-amber-500';
  return 'bg-primary';
}

export function InboxPanelCard({
  icon,
  title,
  badgeLabel,
  badgeTone = 'neutral',
  metaPrimary,
  metaSecondary,
  metaLines,
  progressPct,
  progressTone = 'neutral',
  footerRight,
}: {
  icon: React.ReactNode;
  title: string;
  badgeLabel?: string;
  badgeTone?: InboxPanelBadgeTone;
  metaPrimary?: string;
  metaSecondary?: string;
  metaLines?: string[];
  progressPct?: number;
  progressTone?: InboxPanelProgressTone;
  footerRight?: string;
}) {
  return (
    <InboxContextCard variant="panel">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className={cn('inbox-ctx-title flex items-center gap-1.5', inboxContextCardTitleClass)}>
            {icon}
            <span className="truncate">{title}</span>
          </div>
          {metaPrimary ? (
            <div className={cn('inbox-ctx-meta mt-1 font-mono', inboxContextCardMetaClass)}>{metaPrimary}</div>
          ) : null}
          {metaSecondary ? (
            <div className={cn('inbox-ctx-meta mt-0.5 font-mono', inboxContextCardMetaClass)}>{metaSecondary}</div>
          ) : null}
          {metaLines && metaLines.length > 0 ? (
            <ul className={cn('inbox-ctx-meta mt-2 space-y-0.5', inboxContextCardMetaClass)}>
              {metaLines.map((line, idx) => (
                <li key={`${idx}-${line}`} className="truncate text-xs">
                  · {line}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {badgeLabel ? <span className={cn('shrink-0', badgeClass(badgeTone))}>{badgeLabel}</span> : null}
      </div>
      {progressPct !== undefined ? (
        <>
          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full transition-all duration-500', progressBarClass(progressTone))}
              style={{ width: `${clampPct(progressPct)}%` }}
            />
          </div>
          {footerRight ? (
            <div className={cn('inbox-ctx-meta mt-1 text-right font-mono', inboxContextCardMetaClass)}>{footerRight}</div>
          ) : null}
        </>
      ) : null}
    </InboxContextCard>
  );
}
