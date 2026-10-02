/**
 * Cliente HTTP para API de relatórios Flux Delivery (OAuth2 password + Bearer).
 */
export function createFluxDeliveryClient(cfg) {
  let token = null;
  let tokenExpiresAt = 0;

  async function fetchToken() {
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
    const body = JSON.parse(text);
    token = body.access_token;
    const expiresIn = Number(body.expires_in) || 1200;
    tokenExpiresAt = Date.now() + Math.max(60, expiresIn - 60) * 1000;
    return token;
  }

  async function getAccessToken() {
    if (token && Date.now() < tokenExpiresAt) return token;
    return fetchToken();
  }

  async function apiGet(pathAndQuery) {
    const run = async (retry) => {
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
      return JSON.parse(text);
    };
    return run(false);
  }

  async function fetchAllEntregadores({ pageSize = 50 } = {}) {
    const all = [];
    let page = 0;
    let totalPages = 1;
    while (page < totalPages) {
      const q = new URLSearchParams({ page: String(page), size: String(pageSize) });
      const data = await apiGet(`/v1/relatorios/obter-todos-entregadores?${q}`);
      const batch = data.entregadores || data.content || [];
      all.push(...batch);
      totalPages = Number(data.totalPages) || (batch.length < pageSize ? page + 1 : page + 2);
      page += 1;
      if (!batch.length && page > 0) break;
    }
    return all;
  }

  return { getAccessToken, fetchAllEntregadores, apiGet };
}
