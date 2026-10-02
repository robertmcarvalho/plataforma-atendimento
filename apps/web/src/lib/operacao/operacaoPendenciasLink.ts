export function operacaoPendenciasHref(taskId?: string | null): string {
  if (!taskId) return '/operacao';
  return `/operacao?task=${encodeURIComponent(taskId)}`;
}
