import { cn } from '@/lib/utils';

export function CommercialListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-2 p-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-14 rounded-lg bg-muted" />
      ))}
    </div>
  );
}

export function CommercialKanbanSkeleton() {
  return (
    <div className="flex animate-pulse gap-3 overflow-hidden">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-[360px] w-72 shrink-0 rounded-xl bg-muted" />
      ))}
    </div>
  );
}

export function CommercialDetailSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse space-y-4 p-4', className)}>
      <div className="h-6 w-2/3 rounded bg-muted" />
      <div className="h-4 w-1/2 rounded bg-muted" />
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 rounded bg-muted" />
        ))}
      </div>
    </div>
  );
}
