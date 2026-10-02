/** Clique em menu/select renderizado via portal (fora do painel pai). */
export function isPortaledOverlayTarget(target: Node | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('[data-slot^="select-"]') ||
      target.closest('[role="listbox"]') ||
      target.closest('[role="option"]')
  );
}

/** Select base-ui aberto (popup portaled) — evita fechar painel pai no mousedown. */
export function hasOpenPortaledSelect(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(document.querySelector('[data-slot="select-content"][data-open]'));
}
