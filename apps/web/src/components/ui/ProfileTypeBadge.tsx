'use client';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { ProfileType } from '@/types/contact';

const LABEL: Record<ProfileType, string> = {
  driver: 'Entregador',
  pharmacy: 'Farmácia',
  leader: 'Líder',
  partner: 'Parceiro',
  unknown: 'Desconhecido',
};

function normalizeType(raw: string | null | undefined): ProfileType {
  if (raw === 'driver' || raw === 'pharmacy' || raw === 'leader' || raw === 'partner') return raw;
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
  const sizeCls = size === 'md' ? 'text-[11px]' : 'text-[10px]';

  const variant: Record<ProfileType, string> = {
    driver: 'border-primary/40 bg-primary/10 text-primary',
    pharmacy: 'border-success/40 bg-success/10 text-success',
    leader: 'border-channel-instagram/40 bg-channel-instagram/10 text-channel-instagram',
    partner: 'border-channel-whatsapp/40 bg-channel-whatsapp/10 text-channel-whatsapp',
    unknown: 'border-border bg-background/40 text-muted-foreground',
  };

  return (
    <Badge variant="outline" className={cn('shrink-0 font-medium leading-none', sizeCls, variant[t], className)}>
      {LABEL[t]}
    </Badge>
  );
}
