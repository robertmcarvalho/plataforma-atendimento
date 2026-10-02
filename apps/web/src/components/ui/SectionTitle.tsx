import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Rótulo de seção — alinhado a `CadastroField` (text-xs, medium, muted). */
export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('text-xs font-medium text-muted-foreground', className)}>{children}</div>;
}
