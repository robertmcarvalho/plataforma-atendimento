'use client';

import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type LeaderMasterDetailLayoutProps = {
  list: ReactNode;
  detail: ReactNode;
  hasSelection: boolean;
  onBack: () => void;
  detailTitle?: string;
  className?: string;
};

export function LeaderMasterDetailLayout({
  list,
  detail,
  hasSelection,
  onBack,
  detailTitle,
  className,
}: LeaderMasterDetailLayoutProps) {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className="hidden min-h-0 flex-1 gap-4 overflow-hidden lg:grid lg:grid-cols-[minmax(280px,360px)_1fr]">
        <div className="min-h-0 min-w-0 overflow-y-auto">{list}</div>
        <div className="min-h-0 min-w-0 overflow-y-auto">{detail}</div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:hidden">
        {!hasSelection ? (
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{list}</div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/95 px-1 py-2 backdrop-blur">
              <button
                type="button"
                onClick={onBack}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md hover:bg-sidebar-accent/60"
                aria-label="Voltar para lista"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              {detailTitle ? <span className="min-w-0 truncate text-sm font-semibold">{detailTitle}</span> : null}
            </div>
            <div className="min-h-0 min-w-0 overflow-y-auto">{detail}</div>
          </div>
        )}
      </div>
    </div>
  );
}
