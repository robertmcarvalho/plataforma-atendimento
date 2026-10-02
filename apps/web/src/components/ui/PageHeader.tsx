import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

/** PageHeader — layout padrão Aethera (breadcrumb + título + ações). */
type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  compact?: boolean;
  icon?: LucideIcon;
  live?: boolean;
};

export function PageHeader({
  eyebrow = '',
  title,
  description,
  actions,
  compact,
  icon: Icon = Sparkles,
  live = false,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'relative overflow-hidden rounded-xl border border-border bg-card',
        compact ? 'mb-4' : 'mb-6'
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(800px_circle_at_20%_0%,hsl(190_90%_55%/.12),transparent_60%),radial-gradient(600px_circle_at_80%_100%,hsl(175_80%_45%/.08),transparent_60%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="relative flex flex-col gap-3 px-4 py-5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-gradient-to-br from-primary/20 to-primary-glow/10 text-primary">
            <Icon className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tightest">{title}</h1>
              {eyebrow ? (
                <span className="hidden font-mono text-[10px] uppercase tracking-widest text-primary md:inline">
                  {eyebrow}
                </span>
              ) : null}
            </div>
            {description ? <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{description}</p> : null}
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {live ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              <span className="text-muted-foreground">Tempo real</span>
              <span className="font-mono">ONLINE</span>
            </div>
          ) : null}
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </div>
    </header>
  );
}
