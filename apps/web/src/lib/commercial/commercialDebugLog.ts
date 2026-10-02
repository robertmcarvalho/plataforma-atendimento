/** Logs de diagnóstico CRM comercial. Ative em prod: localStorage.setItem('commercial_debug', '1') */
export function isCommercialDebugEnabled(): boolean {
  if (typeof window === 'undefined') return process.env.NODE_ENV === 'development';
  try {
    return (
      process.env.NODE_ENV === 'development' || localStorage.getItem('commercial_debug') === '1'
    );
  } catch {
    return process.env.NODE_ENV === 'development';
  }
}

function formatPayload(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

export function commercialDebugLog(scope: string, payload: Record<string, unknown>): void {
  if (!isCommercialDebugEnabled()) return;
  console.info(`[commercial:${scope}]`, formatPayload(payload), payload);
}

export function commercialDebugError(scope: string, payload: Record<string, unknown>, err?: unknown): void {
  if (!isCommercialDebugEnabled()) return;
  console.error(`[commercial:${scope}]`, formatPayload(payload), payload, err);
}
