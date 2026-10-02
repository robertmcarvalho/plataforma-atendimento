import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type IconTileTone = 'primary' | 'success' | 'warning' | 'destructive' | 'muted' | 'info';
export type IconTileSize = 'sm' | 'md' | 'lg' | 'xl';

const toneCls: Record<IconTileTone, string> = {
  primary: 'bg-primary/15 text-primary ring-primary/20',
  success: 'bg-success/15 text-success ring-success/20',
  warning: 'bg-warning/15 text-warning ring-warning/20',
  destructive: 'bg-destructive/15 text-destructive ring-destructive/20',
  info: 'bg-channel-instagram/15 text-channel-instagram ring-channel-instagram/20',
  muted: 'bg-muted text-muted-foreground ring-border',
};

const sizeCls: Record<IconTileSize, string> = {
  sm: 'h-7 w-7 rounded-md',
  md: 'h-9 w-9 rounded-lg',
  lg: 'h-11 w-11 rounded-xl',
  xl: 'h-14 w-14 rounded-2xl',
};

const iconSizeCls: Record<IconTileSize, string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-5 w-5',
  xl: 'h-7 w-7',
};

/** Chip arredondado com cor temática — padrão Revive `IconTile.tsx`. */
export function IconTile({
  icon: Icon,
  tone = 'primary',
  size = 'md',
  className,
}: {
  icon: LucideIcon;
  tone?: IconTileTone;
  size?: IconTileSize;
  className?: string;
}) {
  return (
    <div className={cn('flex shrink-0 items-center justify-center ring-1', sizeCls[size], toneCls[tone], className)}>
      <Icon className={iconSizeCls[size]} strokeWidth={1.75} />
    </div>
  );
}
