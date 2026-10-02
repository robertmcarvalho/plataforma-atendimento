export function allowedOriginsList(): string[] {
  return (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function resolveCorsOrigin(requestOrigin: string | undefined): string | null {
  const origin = String(requestOrigin || '').trim();
  const allowed = allowedOriginsList();
  if (origin && allowed.includes(origin)) return origin;
  return null;
}

export function corsHeadersForRequest(requestOrigin: string | undefined): Record<string, string> {
  const origin = resolveCorsOrigin(requestOrigin);
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
  };
}
