/**
 * URL pública do front (login) para e-mails de convite e links transacionais.
 */
export function resolveWebAppLoginUrl(): string {
  const raw =
    process.env.WEB_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    '';

  if (raw) {
    const base = raw.replace(/\/+$/, '');
    if (base.endsWith('/login')) return base;
    return `${base}/login`;
  }

  const port = process.env.WEB_DEV_PORT?.trim() || '3000';
  return `http://localhost:${port}/login`;
}
