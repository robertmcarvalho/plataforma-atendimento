/**
 * Abre rota interna ou URL absoluta em nova aba, mantendo a inbox na aba atual.
 */
export function openAppRouteInNewTab(pathOrUrl: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = pathOrUrl.trim();
  if (!trimmed) return;

  let url: string;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    url = trimmed;
  } else if (trimmed.startsWith('/')) {
    url = new URL(trimmed, window.location.origin).href;
  } else {
    return;
  }

  const lower = url.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) {
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}
