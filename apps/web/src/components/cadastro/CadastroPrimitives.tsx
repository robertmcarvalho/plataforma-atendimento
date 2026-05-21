import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Conteúdo de cadastro com rolagem e largura máxima (padrão project-revive). */
export function CadastroPageScroll({ children, maxWidthClassName = 'max-w-5xl' }: { children: ReactNode; maxWidthClassName?: string }) {
  return (
    <div className="h-full min-h-0 w-full overflow-y-auto">
      <div className={cn('mx-auto px-6 py-8 sm:px-8', maxWidthClassName)}>{children}</div>
    </div>
  );
}

export function CadastroSection({
  title,
  desc,
  action,
  children,
}: {
  title: string;
  desc?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-end justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {desc ? <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function CadastroField({
  icon: Icon,
  label,
  children,
  required,
}: {
  icon?: LucideIcon;
  label: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {Icon ? <Icon className="h-3 w-3 shrink-0" aria-hidden /> : null}
        <span>{label}</span>
        {required ? <span className="text-destructive">*</span> : null}
      </div>
      {children}
    </div>
  );
}
