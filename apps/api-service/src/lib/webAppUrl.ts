/**
 * URL pública do front (login) para e-mails de convite e links transacionais.
 */
export function resolveWebAppBaseUrl(): string {
  const raw =
    process.env.WEB_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    '';

  if (raw) {
    const base = raw.replace(/\/+$/, '');
    if (base.endsWith('/login')) return base.replace(/\/login$/, '');
    return base;
  }

  const port = process.env.WEB_DEV_PORT?.trim() || '3000';
  return `http://localhost:${port}`;
}

export function resolveWebAppLoginUrl(): string {
  return `${resolveWebAppBaseUrl()}/login`;
}

export function resolveCommercialDataRequestPublicUrl(token: string): string {
  return `${resolveWebAppBaseUrl()}/public/commercial/preencher/${encodeURIComponent(token)}`;
}
