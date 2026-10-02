import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconTile, type IconTileTone } from './IconTile';
import { cn } from '@/lib/utils';

export function SectionHeader({
  icon,
  tone = 'primary',
  title,
  trailing,
  className,
}: {
  icon: LucideIcon;
  tone?: IconTileTone;
  title: string;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-2', className)}>
      <h2 className="flex items-center gap-2 font-heading text-base font-medium leading-snug tracking-tight">
        <IconTile icon={icon} tone={tone} size="sm" />
        {title}
      </h2>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}
