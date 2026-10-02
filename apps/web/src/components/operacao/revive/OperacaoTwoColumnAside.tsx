import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function OperacaoTwoColumnAside({
  main,
  aside,
  className,
}: {
  main: ReactNode;
  aside: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid items-start gap-6 lg:grid-cols-3', className)}>
      <div className="order-1 space-y-6 lg:order-none lg:col-span-2">{main}</div>
      <aside className="order-2 space-y-4 lg:sticky lg:top-4 lg:order-none lg:self-start">{aside}</aside>
    </div>
  );
}
