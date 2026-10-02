import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Link «Voltar para …» — padrão ficha/cadastro (entregadores, farmácias, comercial). */
export function CadastroBackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-3 w-3" />
      {children}
    </Link>
  );
}

/** Conteúdo de cadastro com rolagem e largura máxima (padrão project-revive). */
export function CadastroPageScroll({ children, maxWidthClassName = 'max-w-5xl' }: { children: ReactNode; maxWidthClassName?: string }) {
  return (
    <div className="h-full min-h-0 w-full overflow-y-auto">
      <div className={cn('mx-auto px-4 py-6 sm:px-8 sm:py-8', maxWidthClassName)}>{children}</div>
    </div>
  );
}

/** Seção de formulário — Revive `EntregadorCadastro.tsx` Section. */
export const cadastroSectionClassName = 'rounded-xl border border-border bg-surface p-5';

/** Linha de switch (É líder?, Possui MEI?, etc.). */
export const cadastroSwitchRowClassName =
  'flex h-10 items-center justify-between rounded-md border border-border bg-background px-3';

/** Container segmentado inline (Fixo/Diarista). */
export const cadastroSegmentedClassName =
  'flex w-full gap-0.5 rounded-md border border-border bg-background p-0.5';

export function CadastroSection({
  title,
  desc,
  action,
  children,
  className,
}: {
  title: string;
  desc?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(cadastroSectionClassName, className)}>
      <div className="mb-4 flex items-end justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0 space-y-0.5">
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
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {Icon ? <Icon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden /> : null}
        <span>{label}</span>
        {required ? <span className="text-destructive">*</span> : null}
      </label>
      {children}
    </div>
  );
}
