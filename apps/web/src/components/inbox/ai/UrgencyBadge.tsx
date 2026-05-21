'use client';

import { cn } from '@/lib/utils';

export type UrgencyValue = 'alta' | 'media' | 'baixa' | string;

const LABEL: Record<string, string> = {
  alta: 'Urgência alta (IA)',
  media: 'Urgência média (IA)',
  baixa: 'Urgência baixa (IA)',
};

/** Bolinha compacta para lista de conversas */
export function UrgencyDot({ urgency }: { urgency?: string | null }) {
  if (!urgency) return null;
  const title = LABEL[urgency] || 'Urgência (IA)';
  const cls =
    urgency === 'alta'
      ? 'bg-destructive shadow-[0_0_6px_-1px] shadow-destructive/80'
      : urgency === 'media'
        ? 'bg-warning shadow-[0_0_6px_-1px] shadow-warning/60'
        : 'bg-muted-foreground/55';
  return (
    <span title={title} aria-label={title} className={cn('inline-block h-2 w-2 shrink-0 rounded-full', cls)} />
  );
}

export function UrgencyBadge({ urgency }: { urgency?: string | null }) {
  if (!urgency) return null;
  const pill =
    urgency === 'alta'
      ? 'bg-destructive/15 text-destructive border-destructive/30'
      : urgency === 'media'
        ? 'bg-warning/15 text-warning border-warning/30'
        : 'bg-muted/40 text-muted-foreground border-border';
  return (
    <span title={LABEL[urgency] || urgency} className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize', pill)}>
      {urgency}
    </span>
  );
}
