export type FluxDeliveryConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
};

export function isFluxDeliverySkipped(): boolean {
  const v = process.env.FLUX_DELIVERY_SKIP?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function loadFluxDeliveryConfig(): FluxDeliveryConfig | null {
  if (isFluxDeliverySkipped()) return null;

  const baseUrl =
    process.env.FLUX_DELIVERY_BASE_URL?.trim()?.replace(/\/$/, '') ||
    'https://delivery-flux-it.com.br';
  const clientSecret = process.env.FLUX_DELIVERY_OAUTH_CLIENT_SECRET?.trim() || '';
  const username = process.env.FLUX_DELIVERY_USERNAME?.trim() || '';
  const password = process.env.FLUX_DELIVERY_PASSWORD?.trim() || '';

  if (!clientSecret || !username || !password) return null;

  return {
    baseUrl,
    clientId: process.env.FLUX_DELIVERY_OAUTH_CLIENT_ID?.trim() || 'SD',
    clientSecret,
    username,
    password,
  };
}
