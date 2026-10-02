/** Converte timestamp Unix (segundos) do webhook Meta em ISO UTC. */
export function metaWebhookTimestampToIso(msg: Record<string, unknown>): string | null {
  const raw = (msg as { timestamp?: string | number }).timestamp;
  if (raw == null || raw === '') return null;

  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    const sec = Number(raw);
    if (sec > 0) return new Date(sec * 1000).toISOString();
  }

  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    const ms = raw > 1e12 ? raw : raw * 1000;
    return new Date(ms).toISOString();
  }

  return null;
}
