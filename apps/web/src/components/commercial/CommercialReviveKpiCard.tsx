'use client';

import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { IconTile, type IconTileSize, type IconTileTone } from '@/components/ui/IconTile';
import { Sparkline } from '@/components/ui/Sparkline';
import { reviveKpiCardClassName, reviveKpiCardLgClassName } from '@/lib/reviveSurfaces';
import { cn } from '@/lib/utils';

type DeltaTone = 'up' | 'down' | 'neutral' | 'muted';

export function CommercialReviveKpiCard({
  label,
  value,
  icon,
  tone,
  size = 'md',
  valueClassName,
  deltaLabel,
  deltaTone = 'muted',
  sparkline,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone: IconTileTone;
  size?: 'sm' | 'lg';
  valueClassName?: string;
  deltaLabel?: string | null;
  deltaTone?: DeltaTone | 'success' | 'warning' | 'destructive' | 'primary';
  sparkline?: number[];
}) {
  const shell = size === 'lg' ? reviveKpiCardLgClassName : reviveKpiCardClassName;
  const tileSize: IconTileSize = size === 'lg' ? 'md' : 'sm';

  const resolvedDelta: DeltaTone =
    deltaTone === 'success' || deltaTone === 'up'
      ? 'up'
      : deltaTone === 'destructive' || deltaTone === 'down'
        ? 'down'
        : deltaTone === 'warning' || deltaTone === 'primary' || deltaTone === 'neutral'
          ? 'neutral'
          : deltaTone;

  const deltaClass =
    resolvedDelta === 'up'
      ? 'text-success'
      : resolvedDelta === 'down'
        ? 'text-destructive'
        : 'text-muted-foreground';

  return (
    <div className={cn(shell, 'transition-colors hover:bg-sidebar-accent/40')}>
      <div className="flex items-start justify-between gap-2">
        <IconTile icon={icon} tone={tone} size={tileSize} />
        {deltaLabel ? (
          <span className={cn('inline-flex items-center gap-0.5 font-mono text-[10px] font-medium', deltaClass)}>
            {resolvedDelta === 'up' ? <ArrowUpRight className="h-3 w-3" strokeWidth={2} /> : null}
            {resolvedDelta === 'down' ? <ArrowDownRight className="h-3 w-3" strokeWidth={2} /> : null}
            {deltaLabel}
          </span>
        ) : sparkline?.length ? (
          <Sparkline values={sparkline} className="h-6 w-20 shrink-0 opacity-90" width={80} height={24} />
        ) : null}
      </div>
      <div className={size === 'lg' ? 'mt-4' : 'mt-3'}>
        <div className={cn('font-mono text-xl font-semibold tracking-tight', valueClassName)}>{value}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
      </div>
      {sparkline?.length && deltaLabel ? (
        <div className="mt-2">
          <Sparkline values={sparkline} className="h-8 w-full opacity-90" />
        </div>
      ) : null}
    </div>
  );
}
