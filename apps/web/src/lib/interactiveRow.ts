import { cn } from '@/lib/utils';

/** Hover azul Revive — listas, nav, toolbars interativas. */
export const interactiveHover =
  'hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground';

/** Estado ativo/selecionado azul Revive. */
export const interactiveActive = 'bg-sidebar-accent text-sidebar-accent-foreground';

/** Linha/lista selecionável — padrão sidebar (fundo + foreground coordenados). */
export function interactiveRowSurface(active?: boolean) {
  return cn(
    'group transition-colors',
    active
      ? 'bg-sidebar-accent/70 text-sidebar-accent-foreground'
      : 'hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
  );
}

/** Alias de `interactiveRowSurface`. */
export const interactiveSurface = interactiveRowSurface;

export function interactiveRowPrimary(active?: boolean) {
  return cn(
    active
      ? 'text-sidebar-accent-foreground'
      : 'text-foreground group-hover:text-sidebar-accent-foreground'
  );
}

export function interactiveRowSecondary(active?: boolean) {
  return cn(
    active
      ? 'text-sidebar-accent-foreground/80'
      : 'text-muted-foreground group-hover:text-sidebar-accent-foreground/75'
  );
}

export function interactiveRowMuted(active?: boolean) {
  return cn(
    active
      ? 'text-sidebar-accent-foreground/70'
      : 'text-subtle-foreground group-hover:text-sidebar-accent-foreground/65'
  );
}

export function interactiveRowActiveBar(active?: boolean) {
  return cn('absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-primary', !active && 'opacity-0');
}

/** Item da nav lateral em Configurações (Revive `Configuracoes.tsx`). */
export function settingsNavItem(active?: boolean) {
  return cn(
    'group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors',
    active ? interactiveActive : cn('text-foreground', interactiveHover)
  );
}

/** Navegação compacta (pastas inbox, filtros) — espelha Sidebar.tsx. */
export function interactiveNavItem(active?: boolean) {
  return cn(
    'flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
    active
      ? interactiveActive
      : cn('text-muted-foreground', interactiveHover)
  );
}

export function interactiveNavCount(active?: boolean) {
  return cn(
    'font-mono inbox-t-meta',
    active ? 'text-sidebar-accent-foreground/80' : 'text-subtle-foreground'
  );
}

/** Item de menu dropdown / popover (inbox, menus ⋯). */
export function popoverMenuItem(active?: boolean) {
  return cn(
    'w-full rounded-lg px-3 py-2 text-left text-xs transition-colors',
    active
      ? interactiveActive
      : cn('text-foreground', interactiveHover)
  );
}

/** Botão ícone sem borda (fechar, ações compactas). */
export const iconButtonHover =
  'rounded-md p-1 text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground';

export type SemanticPillTone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'destructive'
  | 'info'
  | 'danger';

const SEMANTIC_PILL: Record<SemanticPillTone, string> = {
  neutral: 'bg-muted/50 text-foreground/80 border-border ring-border/40',
  primary: 'bg-primary/20 text-primary border-primary/25 ring-primary/20',
  success: 'bg-success/20 text-success border-success/25 ring-success/20',
  warning: 'bg-warning/20 text-warning border-warning/25 ring-warning/20',
  destructive: 'bg-destructive/20 text-destructive border-destructive/25 ring-destructive/20',
  info: 'bg-sky-500/20 text-sky-300 border-sky-500/25 ring-sky-500/20',
  danger: 'bg-destructive/20 text-destructive border-destructive/25 ring-destructive/20',
};

export function semanticPillClass(tone: SemanticPillTone = 'neutral', extra?: string) {
  return cn('rounded border px-1.5 py-0.5 font-medium ring-1', SEMANTIC_PILL[tone], extra);
}

const CATALOG_TONE_MAP: Record<string, SemanticPillTone> = {
  warning: 'warning',
  success: 'success',
  primary: 'primary',
  info: 'info',
  danger: 'danger',
  destructive: 'destructive',
  neutral: 'neutral',
};

export function catalogToneToPill(tone: string | null | undefined, extra?: string) {
  return semanticPillClass(CATALOG_TONE_MAP[tone || 'neutral'] || 'neutral', extra);
}

export function uiTagToneToPill(tone: 'warning' | 'success' | 'primary', extra?: string) {
  return semanticPillClass(tone, extra);
}
