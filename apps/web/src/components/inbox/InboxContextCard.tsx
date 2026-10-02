'use client';

import { cn } from '@/lib/utils';

export type InboxContextCardVariant = 'sla' | 'sla-focus' | 'vinculo' | 'panel';

const PANEL_CARD_CLASS = 'rounded-xl border border-border bg-background/40 text-foreground shadow-sm';

const VARIANT_CLASS: Record<InboxContextCardVariant, string> = {
  sla: PANEL_CARD_CLASS,
  'sla-focus': 'rounded-xl border border-primary/35 bg-primary/8 text-foreground shadow-sm',
  vinculo: PANEL_CARD_CLASS,
  panel: PANEL_CARD_CLASS,
};

export const inboxContextCardTitleClass = 'text-xs font-semibold text-foreground';
export const inboxContextCardMetaClass = 'text-xs text-foreground/75';

export function InboxContextCard({
  variant = 'sla',
  className,
  children,
}: {
  variant?: InboxContextCardVariant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'px-3.5 py-3 transition-colors',
        VARIANT_CLASS[variant],
        className
      )}
    >
      {children}
    </div>
  );
}
