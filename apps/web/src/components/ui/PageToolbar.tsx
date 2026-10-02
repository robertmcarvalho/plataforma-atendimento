import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Barra de ações de página — alinhar primary/outline/ghost ao Button canônico. */
export function PageToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('flex flex-wrap items-center gap-2', className)}>{children}</div>;
}
