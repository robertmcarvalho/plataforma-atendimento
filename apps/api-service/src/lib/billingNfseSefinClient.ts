/**
 * Cliente HTTP mTLS da Sefin Nacional — somente produção restrita neste sprint.
 * POST /nfse com dpsXmlGZipB64; bloqueia hosts de produção.
 */

import https from 'node:https';
import { URL } from 'node:url';
import {
  assertSefinHostAllowedForEnvironment,
  buildSefinHttpsBaseUrl,
} from './billingNfseConfig';
import { BILLING_NFSE_SEFIN_HOSTS, type BillingNfseEnvironment } from './billingNfseTypes';
import type { LoadedPfxMaterial } from './billingNfseSigner';

export const BILLING_NFSE_SEFIN_API_PATH = '/SefinNacional';

export class BillingNfseSefinClientError extends Error {
  status?: number;
  body?: unknown;
  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = 'BillingNfseSefinClientError';
    this.status = status;
    this.body = body;
  }
}

export type SefinEmitResponse = {
  ok: boolean;
  status: number;
  chaveAcesso?: string | null;
  idDps?: string | null;
  nfseXmlGZipB64?: string | null;
  erros?: Array<{ codigo?: string; descricao?: string }>;
  raw: unknown;
};

export type SefinConsultResponse = SefinEmitResponse;

export type SefinEventResponse = {
  ok: boolean;
  status: number;
  chaveAcesso?: string | null;
  nProt?: string | null;
  idEvento?: string | null;
  tipoEvento?: string | null;
  eventoXmlGZipB64?: string | null;
  nfseXmlGZipB64?: string | null;
  erros?: Array<{ codigo?: string; descricao?: string }>;
  raw: unknown;
};

export type DanfseFetchResult = {
  ok: boolean;
  status: number;
  pdf: Buffer | null;
  contentType: string | null;
};

function isProductionSefinHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === BILLING_NFSE_SEFIN_HOSTS.producao.sefin ||
    h === BILLING_NFSE_SEFIN_HOSTS.producao.adn ||
    (h.endsWith('.nfse.gov.br') && !h.includes('producaorestrita'))
  );
}

/**
 * Hard-block: Sprint 2 só fala com produção restrita.
 * Bypass futuro (go-live): BILLING_NFSE_ALLOW_PRODUCAO=true + environment producao.
 */
export function assertSefinClientEnvironmentAllowed(
  environment: BillingNfseEnvironment
): void {
  const allowProd =
    process.env.BILLING_NFSE_ALLOW_PRODUCAO?.trim().toLowerCase() === 'true' ||
    process.env.BILLING_NFSE_ALLOW_PRODUCAO?.trim() === '1';

  if (environment === 'producao' && !allowProd) {
    throw new BillingNfseSefinClientError(
      'PROIBIDO: cliente Sefin recusou environment=producao. ' +
        'Sprint 2 usa apenas producao_restrita (sefin.producaorestrita.nfse.gov.br).'
    );
  }
  if (environment !== 'producao' && environment !== 'producao_restrita') {
    throw new BillingNfseSefinClientError(`Ambiente Sefin inválido: ${String(environment)}`);
  }
}

export function assertSefinRequestUrlAllowed(
  environment: BillingNfseEnvironment,
  urlOrHost: string
): void {
  assertSefinClientEnvironmentAllowed(environment);
  const raw = String(urlOrHost || '').trim();
  let host = raw.toLowerCase();
  try {
    if (raw.includes('://')) host = new URL(raw).hostname.toLowerCase();
    else host = raw.replace(/^https?:\/\//, '').split('/')[0] || '';
  } catch {
    host = raw.replace(/^https?:\/\//, '').split('/')[0] || '';
  }

  const allowProd =
    process.env.BILLING_NFSE_ALLOW_PRODUCAO?.trim().toLowerCase() === 'true' ||
    process.env.BILLING_NFSE_ALLOW_PRODUCAO?.trim() === '1';

  // Hard-block hosts de produção aberta, exceto go-live explícito:
  // environment=producao + BILLING_NFSE_ALLOW_PRODUCAO=true.
  if (isProductionSefinHost(host) && !(environment === 'producao' && allowProd)) {
    throw new BillingNfseSefinClientError(
      `PROIBIDO: host Sefin de produção bloqueado pelo cliente (${host}). ` +
        'Use sefin.producaorestrita.nfse.gov.br.'
    );
  }

  assertSefinHostAllowedForEnvironment(
    environment === 'producao' ? 'producao' : 'producao_restrita',
    host
  );

  if (environment === 'producao_restrita' && !host.includes('producaorestrita')) {
    throw new BillingNfseSefinClientError(
      `PROIBIDO: host não é produção restrita: ${host}`
    );
  }
}

export function buildSefinNacionalBaseUrl(environment: BillingNfseEnvironment): string {
  assertSefinClientEnvironmentAllowed(environment);
  const origin = buildSefinHttpsBaseUrl(environment, 'sefin');
  const base = `${origin}${BILLING_NFSE_SEFIN_API_PATH}`;
  assertSefinRequestUrlAllowed(environment, base);
  return base;
}

/** Base ADN DANFSe — produção restrita por default (hard-block produção). */
export function buildDanfseBaseUrl(environment: BillingNfseEnvironment): string {
  assertSefinClientEnvironmentAllowed(environment);
  const origin = buildSefinHttpsBaseUrl(environment, 'adn');
  const base = `${origin}/danfse`;
  assertSefinRequestUrlAllowed(environment, base);
  return base;
}

export type SefinClientOptions = {
  environment?: BillingNfseEnvironment;
  /** Override base (testes). Ainda passa pelo hard-block de produção. */
  baseUrl?: string;
  material: LoadedPfxMaterial;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class BillingNfseSefinClient {
  readonly environment: BillingNfseEnvironment;
  readonly baseUrl: string;
  private readonly material: LoadedPfxMaterial;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SefinClientOptions) {
    this.environment = options.environment || 'producao_restrita';
    assertSefinClientEnvironmentAllowed(this.environment);
    this.baseUrl = options.baseUrl
      ? String(options.baseUrl).replace(/\/$/, '')
      : buildSefinNacionalBaseUrl(this.environment);
    assertSefinRequestUrlAllowed(this.environment, this.baseUrl);
    this.material = options.material;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImpl = options.fetchImpl || fetch;
  }

  private httpsAgent(): https.Agent {
    return new https.Agent({
      cert: this.material.certChainPem,
      key: this.material.privateKeyPem,
      rejectUnauthorized: true,
      keepAlive: false,
    });
  }

  async postNfse(dpsXmlGZipB64: string): Promise<SefinEmitResponse> {
    const url = `${this.baseUrl}/nfse`;
    assertSefinRequestUrlAllowed(this.environment, url);

    const payload = JSON.stringify({ dpsXmlGZipB64 });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const agent = this.httpsAgent();
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: payload,
        signal: controller.signal,
        // Node undici/fetch: agent via dispatcher not standard; use node https fallback below if needed.
        agent,
      } as RequestInit);

      const text = await res.text();
      let raw: unknown = text;
      try {
        raw = text ? JSON.parse(text) : null;
      } catch {
        raw = text;
      }

      return normalizeSefinEmitResponse(res.status, raw);
    } catch (err) {
      if (err instanceof BillingNfseSefinClientError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/abort/i.test(msg)) {
        throw new BillingNfseSefinClientError(`Timeout Sefin após ${this.timeoutMs}ms`);
      }
      throw new BillingNfseSefinClientError(`Falha HTTP Sefin: ${msg}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * POST via https.request (mTLS confiável no Node) — preferir em smoke real.
   */
  async postNfseWithHttps(dpsXmlGZipB64: string): Promise<SefinEmitResponse> {
    const url = new URL(`${this.baseUrl}/nfse`);
    assertSefinRequestUrlAllowed(this.environment, url.toString());

    const body = JSON.stringify({ dpsXmlGZipB64 });
    const agent = this.httpsAgent();

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          agent,
          timeout: this.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let raw: unknown = text;
            try {
              raw = text ? JSON.parse(text) : null;
            } catch {
              raw = text;
            }
            resolve(normalizeSefinEmitResponse(res.statusCode || 0, raw));
          });
        }
      );
      req.on('timeout', () => {
        req.destroy();
        reject(new BillingNfseSefinClientError(`Timeout Sefin após ${this.timeoutMs}ms`));
      });
      req.on('error', (err) => {
        // Só message — err de TLS pode carregar PeerCertificate com ciclo issuerCertificate.
        const msg = err instanceof Error ? err.message : String(err);
        reject(new BillingNfseSefinClientError(`Falha HTTPS Sefin: ${msg}`));
      });
      req.write(body);
      req.end();
    });
  }

  /**
   * POST /nfse/{chaveAcesso}/eventos — registro de evento (cancelamento e101101).
   * Payload: { pedidoRegistroEventoXmlGZipB64 }. Usa fetchImpl (testes).
   */
  async postNfseEvento(
    chaveAcesso: string,
    pedidoRegistroEventoXmlGZipB64: string
  ): Promise<SefinEventResponse> {
    const chave = String(chaveAcesso || '').trim();
    if (!chave) throw new BillingNfseSefinClientError('chaveAcesso obrigatória para evento NFS-e');
    const url = `${this.baseUrl}/nfse/${encodeURIComponent(chave)}/eventos`;
    assertSefinRequestUrlAllowed(this.environment, url);

    const payload = JSON.stringify({ pedidoRegistroEventoXmlGZipB64 });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const agent = this.httpsAgent();
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: payload,
        signal: controller.signal,
        agent,
      } as RequestInit);

      const text = await res.text();
      let raw: unknown = text;
      try {
        raw = text ? JSON.parse(text) : null;
      } catch {
        raw = text;
      }
      return normalizeSefinEventResponse(res.status, raw);
    } catch (err) {
      if (err instanceof BillingNfseSefinClientError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/abort/i.test(msg)) {
        throw new BillingNfseSefinClientError(`Timeout Sefin evento após ${this.timeoutMs}ms`);
      }
      throw new BillingNfseSefinClientError(`Falha HTTP Sefin evento: ${msg}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * POST evento via https.request (mTLS) — preferir em cancel real.
   */
  async postNfseEventoWithHttps(
    chaveAcesso: string,
    pedidoRegistroEventoXmlGZipB64: string
  ): Promise<SefinEventResponse> {
    const chave = String(chaveAcesso || '').trim();
    if (!chave) throw new BillingNfseSefinClientError('chaveAcesso obrigatória para evento NFS-e');
    const url = new URL(`${this.baseUrl}/nfse/${encodeURIComponent(chave)}/eventos`);
    assertSefinRequestUrlAllowed(this.environment, url.toString());

    const body = JSON.stringify({ pedidoRegistroEventoXmlGZipB64 });
    const agent = this.httpsAgent();

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          agent,
          timeout: this.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let raw: unknown = text;
            try {
              raw = text ? JSON.parse(text) : null;
            } catch {
              raw = text;
            }
            resolve(normalizeSefinEventResponse(res.statusCode || 0, raw));
          });
        }
      );
      req.on('timeout', () => {
        req.destroy();
        reject(new BillingNfseSefinClientError(`Timeout Sefin evento após ${this.timeoutMs}ms`));
      });
      req.on('error', (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        reject(new BillingNfseSefinClientError(`Falha HTTPS Sefin evento: ${msg}`));
      });
      req.write(body);
      req.end();
    });
  }

  /**
   * GET /nfse/{chaveAcesso} — consulta NFS-e autorizada (XML gzip+b64).
   * Usado para backfill de storage quando o POST não trouxe nfseXmlGZipB64.
   */
  async getNfseByChave(chaveAcesso: string): Promise<SefinConsultResponse> {
    const chave = String(chaveAcesso || '').trim();
    if (!chave) throw new BillingNfseSefinClientError('chaveAcesso obrigatória para consulta NFS-e');
    const url = new URL(`${this.baseUrl}/nfse/${encodeURIComponent(chave)}`);
    assertSefinRequestUrlAllowed(this.environment, url.toString());
    return this.httpsJsonGet(url);
  }

  /**
   * GET ADN /danfse/{chaveAcesso} — PDF DANFSe (quando disponível).
   * Falha de PDF não deve derrubar autorização; caller trata ok=false.
   */
  async getDanfsePdf(chaveAcesso: string): Promise<DanfseFetchResult> {
    const chave = String(chaveAcesso || '').trim();
    if (!chave) throw new BillingNfseSefinClientError('chaveAcesso obrigatória para DANFSe');
    const base = buildDanfseBaseUrl(this.environment);
    const url = new URL(`${base}/${encodeURIComponent(chave)}`);
    assertSefinRequestUrlAllowed(this.environment, url.toString());

    return new Promise((resolve, reject) => {
      const agent = this.httpsAgent();
      const req = https.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          method: 'GET',
          headers: { Accept: 'application/pdf, application/json, */*' },
          agent,
          timeout: this.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            const status = res.statusCode || 0;
            const contentType = String(res.headers['content-type'] || '');
            const looksPdf =
              contentType.includes('application/pdf') ||
              (buf.length > 4 && buf.subarray(0, 4).toString('utf8') === '%PDF');
            if (status >= 200 && status < 300 && looksPdf) {
              resolve({ ok: true, status, pdf: buf, contentType: contentType || 'application/pdf' });
              return;
            }
            resolve({ ok: false, status, pdf: null, contentType: contentType || null });
          });
        }
      );
      req.on('timeout', () => {
        req.destroy();
        reject(new BillingNfseSefinClientError(`Timeout ADN DANFSe após ${this.timeoutMs}ms`));
      });
      req.on('error', (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        reject(new BillingNfseSefinClientError(`Falha HTTPS ADN DANFSe: ${msg}`));
      });
      req.end();
    });
  }

  private httpsJsonGet(url: URL): Promise<SefinConsultResponse> {
    const agent = this.httpsAgent();
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          method: 'GET',
          headers: { Accept: 'application/json' },
          agent,
          timeout: this.timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let raw: unknown = text;
            try {
              raw = text ? JSON.parse(text) : null;
            } catch {
              raw = text;
            }
            resolve(normalizeSefinEmitResponse(res.statusCode || 0, raw));
          });
        }
      );
      req.on('timeout', () => {
        req.destroy();
        reject(new BillingNfseSefinClientError(`Timeout Sefin após ${this.timeoutMs}ms`));
      });
      req.on('error', (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        reject(new BillingNfseSefinClientError(`Falha HTTPS Sefin: ${msg}`));
      });
      req.end();
    });
  }
}

function parseSefinErros(obj: Record<string, unknown> | null): Array<{ codigo?: string; descricao?: string }> | undefined {
  const errosRaw = obj?.erros ?? obj?.erro ?? null;
  let erros: Array<{ codigo?: string; descricao?: string }> | undefined;
  if (Array.isArray(errosRaw)) {
    erros = errosRaw.map((e) => {
      const row = e as Record<string, unknown>;
      return {
        codigo: row.codigo != null ? String(row.codigo) : row.Codigo != null ? String(row.Codigo) : undefined,
        descricao:
          row.descricao != null
            ? String(row.descricao)
            : row.Descricao != null
              ? String(row.Descricao)
              : undefined,
      };
    });
  } else if (errosRaw && typeof errosRaw === 'object') {
    const row = errosRaw as Record<string, unknown>;
    erros = [
      {
        codigo: row.codigo != null ? String(row.codigo) : undefined,
        descricao: row.descricao != null ? String(row.descricao) : undefined,
      },
    ];
  }
  return erros;
}

export function normalizeSefinEmitResponse(status: number, raw: unknown): SefinEmitResponse {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const erros = parseSefinErros(obj);

  const chave =
    (obj?.chaveAcesso as string | undefined) ||
    (obj?.chave_acesso as string | undefined) ||
    null;
  const idDps = (obj?.idDps as string | undefined) || (obj?.id_dps as string | undefined) || null;
  const nfseXml =
    (obj?.nfseXmlGZipB64 as string | undefined) ||
    (obj?.nfseXmlGzipB64 as string | undefined) ||
    null;

  const hasErro = Boolean(erros && erros.length > 0);
  const ok = status >= 200 && status < 300 && !hasErro && Boolean(chave || nfseXml);

  return {
    ok,
    status,
    chaveAcesso: chave,
    idDps,
    nfseXmlGZipB64: nfseXml,
    erros,
    raw,
  };
}

function pickString(obj: Record<string, unknown> | null, keys: string[]): string | null {
  if (!obj) return null;
  for (const key of keys) {
    const v = obj[key];
    if (v != null && String(v).trim()) return String(v);
  }
  return null;
}

export function normalizeSefinEventResponse(status: number, raw: unknown): SefinEventResponse {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const errosRaw = obj?.erros ?? obj?.erro ?? null;
  let erros: Array<{ codigo?: string; descricao?: string }> | undefined;
  if (Array.isArray(errosRaw)) {
    erros = errosRaw.map((e) => {
      const row = e as Record<string, unknown>;
      return {
        codigo: row.codigo != null ? String(row.codigo) : row.Codigo != null ? String(row.Codigo) : undefined,
        descricao:
          row.descricao != null
            ? String(row.descricao)
            : row.Descricao != null
              ? String(row.Descricao)
              : undefined,
      };
    });
  } else if (errosRaw && typeof errosRaw === 'object') {
    const row = errosRaw as Record<string, unknown>;
    erros = [
      {
        codigo: row.codigo != null ? String(row.codigo) : undefined,
        descricao: row.descricao != null ? String(row.descricao) : undefined,
      },
    ];
  }

  const chave = pickString(obj, ['chaveAcesso', 'chave_acesso']);
  const nProt = pickString(obj, ['nProt', 'nprot', 'protocolo', 'numeroProtocolo', 'nProtocolo']);
  const idEvento = pickString(obj, ['idEvento', 'id_evento']);
  const tipoEvento = pickString(obj, ['tipoEvento', 'tipo_evento']);
  const eventoXml =
    pickString(obj, ['eventoXmlGZipB64', 'eventoXmlGzipB64', 'pedidoRegistroEventoXmlGZipB64']) ||
    null;
  const nfseXml = pickString(obj, ['nfseXmlGZipB64', 'nfseXmlGzipB64']);

  const hasErro = Boolean(erros && erros.length > 0);
  const ok = status >= 200 && status < 300 && !hasErro && Boolean(nProt || eventoXml || chave);

  return {
    ok,
    status,
    chaveAcesso: chave,
    nProt,
    idEvento,
    tipoEvento,
    eventoXmlGZipB64: eventoXml,
    nfseXmlGZipB64: nfseXml,
    erros,
    raw,
  };
}
