'use client';

import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type LeaderPageProps = {
  children: ReactNode;
  className?: string;
  /** Full-height panel (chat) — uses dvh and leader chrome CSS vars */
  fullHeight?: boolean;
};

export function LeaderPage({ children, className, fullHeight }: LeaderPageProps) {
  return (
    <div
      className={cn(
        'mx-auto w-full min-w-0 max-w-7xl p-4 sm:p-6 lg:p-8',
        fullHeight
          ? 'mx-0 flex min-h-0 max-w-none flex-1 flex-col lg:mx-auto lg:max-w-7xl'
          : 'h-full min-h-0 overflow-y-auto overscroll-contain',
        className
      )}
      style={
        fullHeight
          ? ({
              ['--leader-chrome' as string]: '7.5rem',
            } as CSSProperties)
          : undefined
      }
    >
      {children}
    </div>
  );
}
