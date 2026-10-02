import { cn } from '@/lib/utils';
import { interactiveHover } from '@/lib/interactiveRow';

/** KPI strip — Revive `Entregadores.tsx` / `Farmacias.tsx`. */
export const reviveKpiCardClassName = 'rounded-xl border border-border bg-surface p-4';

/** Tabela de listagem. */
export const reviveTableShellClassName = 'overflow-hidden rounded-xl border border-border bg-surface';

export const reviveTableHeadRowClassName =
  'border-b border-border bg-background text-left text-[10px] font-medium uppercase tracking-wider text-subtle-foreground';

export const reviveTableRowClassName =
  'group border-b border-border/50 last:border-0 transition-colors cursor-pointer hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground';

export function reviveTableRow(active?: boolean) {
  return cn(
    'group border-b border-border/50 last:border-0 transition-colors cursor-pointer',
    active
      ? 'bg-sidebar-accent/70 text-sidebar-accent-foreground'
      : 'hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
  );
}

/** Card grid — farmácias / líderes. */
export const reviveListCardClassName =
  'group rounded-xl border border-border bg-surface p-5 transition-colors hover:bg-sidebar-accent/40 hover:border-primary/40';

/** KPI grande — financeiro. */
export const reviveKpiCardLgClassName = 'rounded-xl border border-border bg-surface p-5';

/** Botão outline secundário (exportar, atualizar). */
export const reviveOutlineButtonClassName = cn(
  'inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium transition-colors text-muted-foreground',
  interactiveHover
);

/** Botão secundário de toolbar (limpar filtros, etc.). */
export const reviveToolbarButtonClassName = cn(
  'rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium text-muted-foreground transition-colors',
  interactiveHover
);

export function reviveStatusPill(
  tone: 'success' | 'warning' | 'neutral' | 'muted'
) {
  return cn(
    'rounded px-2 py-0.5 text-[10px] font-medium',
    tone === 'success' && 'bg-success/15 text-success',
    tone === 'warning' && 'bg-warning/15 text-warning',
    tone === 'neutral' && 'bg-muted text-muted-foreground',
    tone === 'muted' && 'bg-muted/50 text-subtle-foreground'
  );
}
