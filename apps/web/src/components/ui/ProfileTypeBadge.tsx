'use client';

import { cn } from '@/lib/utils';
import type { ProfileType } from '@/types/contact';

const LABEL: Record<ProfileType, string> = {
  driver: 'Entregador',
  pharmacy: 'Farmácia',
  leader: 'Líder',
  unknown: 'Desconhecido',
};

function normalizeType(raw: string | null | undefined): ProfileType {
  if (raw === 'driver' || raw === 'pharmacy' || raw === 'leader') return raw;
  return 'unknown';
}

export function ProfileTypeBadge({
  type,
  className,
  size = 'sm',
}: {
  type: string | null | undefined;
  className?: string;
  size?: 'sm' | 'md';
}) {
  const t = normalizeType(type);
  const sizeCls =
    size === 'md'
      ? 'rounded-md px-2 py-0.5 text-[11px]'
      : 'rounded px-1.5 py-0.5 text-[10px]';

  const variant: Record<ProfileType, string> = {
    driver: 'border-primary/40 bg-primary/10 text-primary',
    pharmacy: 'border-success/40 bg-success/10 text-success',
    leader: 'border-channel-instagram/40 bg-channel-instagram/10 text-channel-instagram',
    unknown: 'border-border bg-background/40 text-muted-foreground',
  };

  return (
    <span className={cn('inline-flex shrink-0 border font-medium leading-none', sizeCls, variant[t], className)}>
      {LABEL[t]}
    </span>
  );
}
