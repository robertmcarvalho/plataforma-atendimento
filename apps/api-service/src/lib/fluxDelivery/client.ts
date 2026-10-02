import type { FluxDeliveryConfig } from './config';
import { loadFluxDeliveryConfig } from './config';

export type FluxDeliveryClient = ReturnType<typeof createFluxDeliveryClient>;

export function createFluxDeliveryClient(cfg: FluxDeliveryConfig) {
  let token: string | null = null;
  let tokenExpiresAt = 0;

  const withDayBounds = (dateOnly: string, boundary: 'start' | 'end') => {
    const value = String(dateOnly || '').trim();
    if (/\d{2}:\d{2}:\d{2}/.test(value)) return value;
    return `${value.slice(0, 10)} ${boundary === 'start' ? '00:00:00' : '23:59:59'}`;
  };

  async function fetchToken(): Promise<string> {
    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
    const res = await fetch(`${cfg.baseUrl}/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({
        username: cfg.username,
        password: cfg.password,
        grant_type: 'password',
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Flux token ${res.status}: ${text.slice(0, 400)}`);
    }
    const body = JSON.parse(text) as { access_token?: string; expires_in?: number };
    token = body.access_token || '';
    const expiresIn = Number(body.expires_in) || 1200;
    tokenExpiresAt = Date.now() + Math.max(60, expiresIn - 60) * 1000;
    return token;
  }

  async function getAccessToken(): Promise<string> {
    if (token && Date.now() < tokenExpiresAt) return token;
    return fetchToken();
  }

  async function apiGet<T = unknown>(pathAndQuery: string): Promise<T> {
    const run = async (retry: boolean): Promise<T> => {
      const accessToken = await getAccessToken();
      const res = await fetch(`${cfg.baseUrl}${pathAndQuery}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.status === 401 && !retry) {
        token = null;
        tokenExpiresAt = 0;
        return run(true);
      }
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Flux GET ${pathAndQuery} → ${res.status}: ${text.slice(0, 400)}`);
      }
      return JSON.parse(text) as T;
    };
    return run(false);
  }

  async function fetchAllPaginated<T>(
    buildPath: (page: number, pageSize: number) => string,
    extractBatch: (data: Record<string, unknown>) => T[],
    pageSize = 50,
  ): Promise<T[]> {
    const all: T[] = [];
    let page = 0;
    let totalPages = 1;
    while (page < totalPages) {
      const data = (await apiGet(buildPath(page, pageSize))) as Record<string, unknown>;
      const batch = extractBatch(data);
      all.push(...batch);
      totalPages = Number(data.totalPages) || (batch.length < pageSize ? page + 1 : page + 2);
      page += 1;
      if (!batch.length && page > 0) break;
    }
    return all;
  }

  async function fetchAllEntregadores(opts: { pageSize?: number } = {}) {
    const pageSize = opts.pageSize ?? 50;
    return fetchAllPaginated<Record<string, unknown>>(
      (page, size) => `/v1/relatorios/obter-todos-entregadores?${new URLSearchParams({ page: String(page), size: String(size) })}`,
      (data) => (data.entregadores as Record<string, unknown>[]) || (data.content as Record<string, unknown>[]) || [],
      pageSize,
    );
  }

  async function fetchAllFarmacias(opts: { pageSize?: number } = {}) {
    const pageSize = opts.pageSize ?? 50;
    return fetchAllPaginated<Record<string, unknown>>(
      (page, size) => `/v1/relatorios/obter-todas-farmacias?${new URLSearchParams({ page: String(page), size: String(size) })}`,
      (data) => (data.farmacias as Record<string, unknown>[]) || (data.content as Record<string, unknown>[]) || [],
      pageSize,
    );
  }

  async function fetchEntregasPorPeriodo(params: {
    dataInicio: string;
    dataFim: string;
    pageSize?: number;
  }) {
    const pageSize = params.pageSize ?? 50;
    return fetchAllPaginated<Record<string, unknown>>(
      (page, size) => {
        const q = new URLSearchParams({
          page: String(page),
          size: String(size),
          dataInicial: withDayBounds(params.dataInicio, 'start'),
          dataFinal: withDayBounds(params.dataFim, 'end'),
        });
        return `/v1/relatorios/obter-todas-entregas?${q}`;
      },
      (data) => (data.entregas as Record<string, unknown>[]) || (data.content as Record<string, unknown>[]) || [],
      pageSize,
    );
  }

  return {
    getAccessToken,
    apiGet,
    fetchAllEntregadores,
    fetchAllFarmacias,
    fetchEntregasPorPeriodo,
  };
}

let cachedClient: FluxDeliveryClient | null | undefined;

export function getFluxDeliveryClient(): FluxDeliveryClient | null {
  if (cachedClient !== undefined) return cachedClient;
  const cfg = loadFluxDeliveryConfig();
  cachedClient = cfg ? createFluxDeliveryClient(cfg) : null;
  return cachedClient;
}
