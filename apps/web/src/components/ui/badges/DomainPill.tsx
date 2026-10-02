import type { ReactNode } from 'react';
import { semanticPillClass, type SemanticPillTone } from '@/lib/interactiveRow';
import { cn } from '@/lib/utils';

/** Pill de domínio — delega a semanticPillClass. */
export function DomainPill({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: SemanticPillTone;
  className?: string;
  children: ReactNode;
}) {
  return <span className={cn(semanticPillClass(tone, 'text-[10px]'), className)}>{children}</span>;
}
