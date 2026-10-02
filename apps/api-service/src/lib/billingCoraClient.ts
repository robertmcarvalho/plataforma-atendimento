/**
 * Cliente HTTP Cora Integração Direta — mTLS + client_credentials + POST /v2/invoices.
 * Usa https.request (mesmo padrão confiável do Sefin client).
 */

import https from 'node:https';
import { URL } from 'node:url';
import { assertCoraHostAllowedForEnvironment, coraBaseUrl } from './billingCoraConfig';
import type { LoadedCoraMtlsMaterial } from './billingCoraSecrets';
import type {
  BillingCoraEnvironment,
  CoraAccountBalanceResponse,
  CoraBankStatementQuery,
  CoraInvoiceCreatePayload,
  CoraInvoiceCreateResponse,
  CoraTokenResponse,
} from './billingCoraTypes';
import type { CoraStatementPage } from './billingCoraStatementMapper';

export class BillingCoraClientError extends Error {
  status?: number;
  body?: unknown;
  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = 'BillingCoraClientError';
    this.status = status;
    this.body = body;
  }
}

export type BillingCoraClientOptions = {
  environment: BillingCoraEnvironment;
  clientId: string;
  material: LoadedCoraMtlsMaterial;
  timeoutMs?: number;
  /** Injecção para testes unitários. */
  requestImpl?: typeof httpsRequestJson;
};

export type HttpsJsonResult = {
  status: number;
  body: unknown;
  rawText: string;
};

export async function httpsRequestJson(params: {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | null;
  cert: string;
  key: string;
  timeoutMs: number;
}): Promise<HttpsJsonResult> {
  const url = new URL(params.url);
  const body = params.body ?? null;
  const headers: Record<string, string> = { ...(params.headers || {}) };
  if (body != null && headers['Content-Length'] == null) {
    headers['Content-Length'] = String(Buffer.byteLength(body));
  }

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: params.method,
        headers,
        cert: params.cert,
        key: params.key,
        rejectUnauthorized: true,
        timeout: params.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on('end', () => {
          const rawText = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown = rawText;
          try {
            parsed = rawText ? JSON.parse(rawText) : null;
          } catch {
            parsed = rawText;
          }
          resolve({ status: res.statusCode || 0, body: parsed, rawText });
        });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error(`Timeout Cora após ${params.timeoutMs}ms`));
    });
    req.on('error', (err) => reject(err));
    if (body != null) req.write(body);
    req.end();
  });
}

export function buildCoraTokenFormBody(clientId: string): string {
  const id = String(clientId || '').trim();
  if (!id) throw new BillingCoraClientError('client_id obrigatório para token Cora.');
  return new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: id,
  }).toString();
}

export function mapCoraInvoiceStatusToBankSlip(status: string | null | undefined): string {
  const s = String(status || '').trim().toUpperCase();
  if (s === 'PAID' || s === 'CLOSED') return 'paid';
  if (s === 'CANCELLED' || s === 'CANCELED') return 'canceled';
  if (s === 'OPEN' || s === 'LATE' || s === 'DRAFT') return 'open';
  return 'open';
}

export class BillingCoraClient {
  private environment: BillingCoraEnvironment;
  private clientId: string;
  private material: LoadedCoraMtlsMaterial;
  private timeoutMs: number;
  private requestImpl: typeof httpsRequestJson;
  private cachedToken: { accessToken: string; expiresAtMs: number } | null = null;

  constructor(options: BillingCoraClientOptions) {
    this.environment = options.environment;
    this.clientId = String(options.clientId || '').trim();
    this.material = options.material;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.requestImpl = options.requestImpl || httpsRequestJson;
    if (!this.clientId) throw new BillingCoraClientError('client_id obrigatório.');
  }

  baseUrl(): string {
    return coraBaseUrl(this.environment);
  }

  private async request(
    method: string,
    pathAndQuery: string,
    options?: { body?: unknown; headers?: Record<string, string>; formUrlEncoded?: boolean }
  ): Promise<HttpsJsonResult> {
    const url = `${this.baseUrl()}${pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`}`;
    assertCoraHostAllowedForEnvironment(this.environment, url);

    let body: string | null = null;
    const headers: Record<string, string> = { Accept: 'application/json', ...(options?.headers || {}) };
    if (options?.body !== undefined) {
      if (options.formUrlEncoded) {
        body = typeof options.body === 'string' ? options.body : String(options.body);
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      } else {
        body = JSON.stringify(options.body);
        headers['Content-Type'] = 'application/json';
      }
    }

    try {
      return await this.requestImpl({
        url,
        method,
        headers,
        body,
        cert: this.material.certificatePem,
        key: this.material.privateKeyPem,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/timeout/i.test(msg)) {
        throw new BillingCoraClientError(`Timeout Cora após ${this.timeoutMs}ms`);
      }
      throw new BillingCoraClientError(`Falha HTTP Cora: ${msg}`);
    }
  }

  /** Obtém access_token (cache ~23h para margem sobre expires_in 86400). */
  async getAccessToken(forceRefresh = false): Promise<string> {
    const now = Date.now();
    if (
      !forceRefresh &&
      this.cachedToken &&
      this.cachedToken.expiresAtMs > now + 60_000
    ) {
      return this.cachedToken.accessToken;
    }

    const form = buildCoraTokenFormBody(this.clientId);
    const res = await this.request('POST', '/token', { body: form, formUrlEncoded: true });
    if (res.status < 200 || res.status >= 300) {
      throw new BillingCoraClientError(
        `Token Cora falhou (HTTP ${res.status}). Verifique client_id, cert Stage/Prod e mTLS.`,
        res.status,
        res.body
      );
    }
    const data = res.body as CoraTokenResponse;
    const token = String(data?.access_token || '').trim();
    if (!token) {
      throw new BillingCoraClientError('Resposta de token Cora sem access_token.', res.status, res.body);
    }
    const expiresIn = Number(data.expires_in) || 86400;
    this.cachedToken = {
      accessToken: token,
      expiresAtMs: now + Math.max(expiresIn - 3600, 300) * 1000,
    };
    return token;
  }

  async createInvoice(
    payload: CoraInvoiceCreatePayload,
    idempotencyKey: string
  ): Promise<CoraInvoiceCreateResponse> {
    const key = String(idempotencyKey || '').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
      throw new BillingCoraClientError('Idempotency-Key deve ser UUID.');
    }
    const token = await this.getAccessToken();
    const res = await this.request('POST', '/v2/invoices', {
      body: payload,
      headers: {
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': key,
      },
    });
    if (res.status < 200 || res.status >= 300) {
      const detail =
        typeof res.body === 'object' && res.body
          ? JSON.stringify(res.body).slice(0, 500)
          : String(res.rawText || '').slice(0, 500);
      throw new BillingCoraClientError(
        `Emissão boleto Cora falhou (HTTP ${res.status}): ${detail}`,
        res.status,
        res.body
      );
    }
    const data = res.body as CoraInvoiceCreateResponse;
    if (!data?.id) {
      throw new BillingCoraClientError('Resposta Cora sem id de invoice.', res.status, res.body);
    }
    return data;
  }

  /**
   * Cancela boleto não pago — DELETE /v2/invoices/{invoice_id}.
   * Sucesso típico: HTTP 200 ou 204. Não use em boleto já pago (REC-0006 / 422).
   */
  async cancelInvoice(coraInvoiceId: string): Promise<void> {
    const id = String(coraInvoiceId || '').trim();
    if (!id) throw new BillingCoraClientError('invoice_id Cora obrigatório para cancelamento.');
    const token = await this.getAccessToken();
    const res = await this.request('DELETE', `/v2/invoices/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 200 || res.status === 204) return;
    const detail =
      typeof res.body === 'object' && res.body
        ? JSON.stringify(res.body).slice(0, 500)
        : String(res.rawText || '').slice(0, 500);
    throw new BillingCoraClientError(
      `Cancelamento boleto Cora falhou (HTTP ${res.status}): ${detail}`,
      res.status,
      res.body
    );
  }

  /** GET /third-party/account/balance → saldo em centavos. */
  async getBalance(): Promise<CoraAccountBalanceResponse> {
    const token = await this.getAccessToken();
    const res = await this.request('GET', '/third-party/account/balance', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status < 200 || res.status >= 300) {
      const detail =
        typeof res.body === 'object' && res.body
          ? JSON.stringify(res.body).slice(0, 500)
          : String(res.rawText || '').slice(0, 500);
      throw new BillingCoraClientError(
        `Saldo Cora falhou (HTTP ${res.status}): ${detail}`,
        res.status,
        res.body
      );
    }
    const data = res.body as CoraAccountBalanceResponse;
    const balance = Number(data?.balance);
    if (!Number.isFinite(balance)) {
      throw new BillingCoraClientError('Resposta de saldo Cora sem balance numérico.', res.status, res.body);
    }
    return { balance };
  }

  /**
   * GET /bank-statement/statement (uma página).
   * perPage tipicamente 100–200 (docs: máx 500; páginas grandes → 503/504).
   */
  async getStatement(query: CoraBankStatementQuery): Promise<CoraStatementPage> {
    const start = String(query.start || '').trim();
    const end = String(query.end || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      throw new BillingCoraClientError('start/end do extrato devem ser YYYY-MM-DD.');
    }
    const page = Math.max(1, Number(query.page) || 1);
    const perPage = Math.min(500, Math.max(1, Number(query.perPage) || 200));
    const params = new URLSearchParams({
      start,
      end,
      page: String(page),
      perPage: String(perPage),
    });
    if (query.type) params.set('type', query.type);
    if (query.transaction_type) params.set('transaction_type', query.transaction_type);
    if (query.aggr === true) params.set('aggr', 'true');

    const token = await this.getAccessToken();
    const res = await this.request('GET', `/bank-statement/statement?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status < 200 || res.status >= 300) {
      const detail =
        typeof res.body === 'object' && res.body
          ? JSON.stringify(res.body).slice(0, 500)
          : String(res.rawText || '').slice(0, 500);
      throw new BillingCoraClientError(
        `Extrato Cora falhou (HTTP ${res.status}): ${detail}`,
        res.status,
        res.body
      );
    }
    return (res.body || {}) as CoraStatementPage;
  }

  /**
   * Pagina o extrato até esgotar páginas (ou totalItems).
   * Retry leve em 503/504; não engole outras falhas.
   */
  async getStatementAll(
    query: Omit<CoraBankStatementQuery, 'page'>,
    options?: { maxPages?: number; retryOnTransient?: number }
  ): Promise<{ pages: CoraStatementPage[]; entries: NonNullable<CoraStatementPage['entries']> }> {
    const maxPages = options?.maxPages ?? 50;
    const retries = options?.retryOnTransient ?? 4;
    const pages: CoraStatementPage[] = [];
    const entries: NonNullable<CoraStatementPage['entries']> = [];
    let page = 1;
    for (;;) {
      if (page > maxPages) {
        throw new BillingCoraClientError(
          `Extrato Cora excedeu maxPages=${maxPages} (possível volume alto ou loop).`
        );
      }
      let lastErr: BillingCoraClientError | null = null;
      let result: CoraStatementPage | null = null;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          result = await this.getStatement({ ...query, page });
          lastErr = null;
          break;
        } catch (err) {
          if (
            err instanceof BillingCoraClientError &&
            (err.status === 503 || err.status === 504) &&
            attempt < retries
          ) {
            lastErr = err;
            await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
            continue;
          }
          throw err;
        }
      }
      if (!result) {
        throw lastErr || new BillingCoraClientError('Extrato Cora sem resposta após retries.');
      }
      pages.push(result);
      const batch = result.entries || [];
      entries.push(...batch);
      const totalPages = Number(result.totalPages);
      if (Number.isFinite(totalPages) && totalPages > 0) {
        if (page >= totalPages) break;
      } else if (batch.length < (query.perPage || 200)) {
        break;
      }
      page += 1;
    }
    return { pages, entries };
  }
}
