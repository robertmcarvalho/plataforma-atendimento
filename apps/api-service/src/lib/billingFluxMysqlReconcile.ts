import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildPharmacyCnpjIndex,
  fluxPharmacyKey,
  normalizeFluxCnpjDigits,
  parseFluxDeliveryAt,
  resolveMysqlDeliveryPharmacyId,
} from '@plataforma/flux-delivery';

export type MysqlReconcileRow = {
  external_id: string;
  /** Fingerprint de negócio (farmácia + doc + minuto) para cruzar com flux_api. */
  fingerprint: string;
  codpes: number;
  codloc: number;
  /** CNPJ da farmácia no MySQL (view_farmacias.CNPJLoc ou arqrotas.CNPJ). */
  cnpj: string | null;
  /** Nome do entregador no catálogo MySQL (arqentregador / view_entregadores). */
  driver_name: string | null;
  driver_flux_id: string;
  driver_cpf: string | null;
  delivered_at: string;
  document_number: string | null;
  route_id: string | null;
};

export type MysqlReconcileResult = {
  period_start: string;
  period_end: string;
  mysql_total: number;
  aethera_flux_db_total: number;
  missing_in_aethera_count: number;
  missing_in_mysql_count: number;
  /** Amostra (não a lista completa — evita payloads enormes). */
  missing_in_aethera: MysqlReconcileRow[];
  missing_in_mysql: Array<{ external_id: string; delivered_at: string; pharmacy_id: string; driver_id: string }>;
  /** Lista completa só para import interno; omitida na resposta HTTP. */
  _missing_in_aethera_all?: MysqlReconcileRow[];
};

export type FluxMysqlConfig = {
  host: string;
  user: string;
  password: string;
  database: string;
};

export type MysqlImportStats = {
  imported: number;
  skipped_unmapped_pharmacy: number;
  skipped_unmapped_driver: number;
  skipped_missing_driver_name: number;
  skipped_duplicate: number;
};

const AETHERA_PAGE = 1000;
const IMPORT_CHUNK = 200;
const SAMPLE_LIMIT = 50;

export function loadFluxMysqlConfig(): FluxMysqlConfig | null {
  const password = process.env.FLUX_MYSQL_PASSWORD?.trim();
  if (!password) return null;
  return {
    host: process.env.FLUX_MYSQL_HOST?.trim() || 'flux.infinitybrasil.net',
    user: process.env.FLUX_MYSQL_USER?.trim() || 'root',
    password,
    database: process.env.FLUX_MYSQL_DATABASE?.trim() || 'dbfluxsinc',
  };
}

/** Remove prefixo legado `mysql:` usado em imports antigos. */
export function normalizeMysqlExternalId(externalId: string): string {
  const raw = String(externalId || '').trim();
  return raw.startsWith('mysql:') ? raw.slice('mysql:'.length) : raw;
}

/** Chave de negócio estável entre API Flux (idEntrega) e MySQL (sem idEntrega). */
export function deliveryBusinessFingerprint(input: {
  flux_codpes?: number | null;
  flux_codloc?: number | null;
  document_number?: string | null;
  delivered_at?: string | null;
}): string | null {
  const codloc = input.flux_codloc != null ? Number(input.flux_codloc) : NaN;
  if (!Number.isFinite(codloc)) return null;
  const codpes = input.flux_codpes != null && Number.isFinite(Number(input.flux_codpes)) ? Number(input.flux_codpes) : 0;
  const doc = String(input.document_number ?? '').trim() || 'na';
  const at = String(input.delivered_at ?? '').trim();
  if (!at) return null;
  // Minuto: tolera drift de segundos / timezone entre API e MySQL.
  return `${codpes}:${codloc}:${doc}:${at.slice(0, 16)}`;
}

export function buildMysqlExternalId(row: {
  codpes: number;
  codloc: number;
  driverFluxId: string;
  documentNumber: string | null;
  deliveredAt: string;
  routeId: string | null;
}): string {
  const routePart = row.routeId ? `:r${row.routeId}` : '';
  return `${row.codpes}:${row.codloc}:${row.driverFluxId}:${row.documentNumber || 'na'}:${row.deliveredAt.slice(0, 19)}${routePart}`;
}

export function resolveMysqlRowCnpj(
  codpes: number,
  codloc: number,
  routeCnpj: unknown,
  farmCnpjByKey: Map<string, string>
): string | null {
  const key = fluxPharmacyKey(codpes, codloc);
  const fromFarm = farmCnpjByKey.get(key);
  if (fromFarm) return fromFarm;
  const fromRoute = normalizeFluxCnpjDigits(routeCnpj);
  return fromRoute || null;
}

export function hasMysqlDriverName(driverName: string | null | undefined): boolean {
  return String(driverName ?? '').trim().length > 0;
}

export type MysqlDriverNameCatalog = {
  byId: Map<string, string>;
  byCpf: Map<string, string>;
};

export function resolveMysqlDriverName(
  driverFluxId: string,
  driverCpf: string | null,
  catalog: MysqlDriverNameCatalog
): string | null {
  const fromId = driverFluxId ? catalog.byId.get(driverFluxId) : undefined;
  if (fromId) return fromId;
  if (driverCpf) {
    const fromCpf = catalog.byCpf.get(driverCpf);
    if (fromCpf) return fromCpf;
  }
  return null;
}

async function loadMysqlDriverNameCatalog(
  conn: { query: (sql: string) => Promise<unknown> }
): Promise<MysqlDriverNameCatalog> {
  const byId = new Map<string, string>();
  const byCpf = new Map<string, string>();
  const queries = [
    `SELECT IDEntr AS driver_flux_id, CPFEntr AS cpf, Noment AS nome FROM arqentregador`,
    `SELECT IDEntr AS driver_flux_id, CPFEntr AS cpf, Noment AS nome FROM view_entregadores`,
    `SELECT IDEntr AS driver_flux_id, CPF AS cpf, Nome AS nome FROM arqentregadores`,
  ];
  for (const sql of queries) {
    try {
      const [rows] = (await conn.query(sql)) as [Record<string, unknown>[]];
      for (const row of rows) {
        const id = String(row.driver_flux_id ?? '').trim();
        const cpf = String(row.cpf ?? '').replace(/\D/g, '');
        const name = String(row.nome ?? '').trim();
        if (!name) continue;
        if (id && !byId.has(id)) byId.set(id, name);
        if (cpf && !byCpf.has(cpf)) byCpf.set(cpf, name);
      }
      if (byId.size || byCpf.size) break;
    } catch {
      // próxima variante de schema
    }
  }
  return { byId, byCpf };
}

async function loadMysqlPharmacyCnpjMap(
  conn: { query: (sql: string) => Promise<unknown> }
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const [rows] = (await conn.query(
      `SELECT Codpes AS codpes, Codloc AS codloc, CNPJLoc AS cnpj FROM dbfluxadm.view_farmacias`
    )) as [Record<string, unknown>[]];
    for (const row of rows) {
      const codpes = Number(row.codpes);
      const codloc = Number(row.codloc);
      if (!Number.isFinite(codpes) || !Number.isFinite(codloc)) continue;
      const cnpj = normalizeFluxCnpjDigits(row.cnpj);
      if (cnpj) map.set(fluxPharmacyKey(codpes, codloc), cnpj);
    }
  } catch {
    // view_farmacias indisponível — fallback para arqrotas.CNPJ por linha.
  }
  return map;
}

async function queryMysqlDeliveries(cfg: FluxMysqlConfig, start: string, end: string): Promise<MysqlReconcileRow[]> {
  let mysql: typeof import('mysql2/promise');
  try {
    mysql = await import('mysql2/promise');
  } catch {
    throw new Error('Pacote mysql2 não instalado. Execute: npm install mysql2 -w api-service');
  }

  const conn = await mysql.createConnection({
    host: cfg.host,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    connectTimeout: 15000,
  });

  try {
    const farmCnpjByKey = await loadMysqlPharmacyCnpjMap(conn);
    const driverCatalog = await loadMysqlDriverNameCatalog(conn);
    const [rows] = await conn.query(
      `
      SELECT s.Codpes AS codpes, s.Codloc AS codloc, s.NroDocto AS nro_docto,
             s.DatHorEnt AS delivered_at, r.IDEntr AS driver_flux_id, r.CPFEntr AS driver_cpf,
             NULLIF(r.CNPJ, '') AS route_cnpj, s.IDRota AS route_id
      FROM arqrotasite s
      JOIN arqrotas r ON r.Codpes = s.Codpes AND r.Codloc = s.Codloc AND r.IDRota = s.IDRota
      WHERE s.DatHorEnt IS NOT NULL
        AND r.IndCanc = 0
        AND DATE(s.DatHorEnt) >= ?
        AND DATE(s.DatHorEnt) <= ?
      `,
      [start, end]
    );

    return (rows as Record<string, unknown>[]).map((row) => {
      const codpes = Number(row.codpes);
      const codloc = Number(row.codloc);
      const cnpj = resolveMysqlRowCnpj(codpes, codloc, row.route_cnpj, farmCnpjByKey);
      const driverFluxId = String(row.driver_flux_id ?? '').trim();
      const driverCpf = String(row.driver_cpf ?? '').replace(/\D/g, '') || null;
      const driverName = resolveMysqlDriverName(driverFluxId, driverCpf, driverCatalog);
      const deliveredAt = parseFluxDeliveryAt({ datHorEnt: row.delivered_at }) || new Date().toISOString();
      const documentNumber = row.nro_docto != null ? String(row.nro_docto).trim() : null;
      const routeId = row.route_id != null ? String(row.route_id).trim() : null;
      const external_id = buildMysqlExternalId({
        codpes,
        codloc,
        driverFluxId,
        documentNumber,
        deliveredAt,
        routeId,
      });
      const fingerprint =
        deliveryBusinessFingerprint({
          flux_codpes: codpes,
          flux_codloc: codloc,
          document_number: documentNumber,
          delivered_at: deliveredAt,
        }) || external_id;
      return {
        external_id,
        fingerprint,
        codpes,
        codloc,
        cnpj,
        driver_name: driverName,
        driver_flux_id: driverFluxId,
        driver_cpf: driverCpf,
        delivered_at: deliveredAt,
        document_number: documentNumber,
        route_id: routeId,
      };
    });
  } finally {
    await conn.end();
  }
}

type AetheraFluxRow = {
  external_id: string;
  delivered_at: string;
  pharmacy_id: string;
  driver_id: string;
  source: string;
  flux_codpes: number | null;
  flux_codloc: number | null;
  document_number: string | null;
};

async function loadAllAetheraFluxRows(
  db: SupabaseClient,
  workspaceId: string,
  start: string,
  end: string
): Promise<AetheraFluxRow[]> {
  const rows: AetheraFluxRow[] = [];
  for (let from = 0; ; from += AETHERA_PAGE) {
    const to = from + AETHERA_PAGE - 1;
    const { data, error } = await db
      .from('billing_delivery_records')
      .select('external_id, delivered_at, pharmacy_id, driver_id, source, flux_codpes, flux_codloc, document_number')
      .eq('workspace_id', workspaceId)
      .in('source', ['flux_api', 'flux_db'])
      .gte('delivered_at', `${start}T00:00:00.000Z`)
      .lte('delivered_at', `${end}T23:59:59.999Z`)
      .range(from, to);
    if (error) throw new Error(error.message);
    rows.push(...((data || []) as AetheraFluxRow[]));
    if (!data || data.length < AETHERA_PAGE) break;
  }
  return rows;
}

function aetheraKnownKeys(aetheraRows: AetheraFluxRow[]): {
  byExternal: Set<string>;
  byFingerprint: Set<string>;
} {
  const byExternal = new Set<string>();
  const byFingerprint = new Set<string>();
  for (const r of aetheraRows) {
    const ext = normalizeMysqlExternalId(String(r.external_id));
    if (ext) byExternal.add(ext);
    const fp = deliveryBusinessFingerprint({
      flux_codpes: r.flux_codpes,
      flux_codloc: r.flux_codloc,
      document_number: r.document_number,
      delivered_at: r.delivered_at,
    });
    if (fp) byFingerprint.add(fp);
  }
  return { byExternal, byFingerprint };
}

export async function reconcileBillingWithFluxMysql(
  db: SupabaseClient,
  workspaceId: string,
  start: string,
  end: string
): Promise<MysqlReconcileResult> {
  const cfg = loadFluxMysqlConfig();
  if (!cfg) throw new Error('FLUX_MYSQL_PASSWORD não configurado');

  const mysqlRows = await queryMysqlDeliveries(cfg, start, end);
  const aetheraRows = await loadAllAetheraFluxRows(db, workspaceId, start, end);
  const { byExternal, byFingerprint } = aetheraKnownKeys(aetheraRows);

  const mysqlByExternal = new Map(mysqlRows.map((r) => [r.external_id, r]));
  const mysqlByFingerprint = new Map(mysqlRows.map((r) => [r.fingerprint, r]));

  const missing_in_aethera_all = mysqlRows.filter(
    (r) => !byExternal.has(r.external_id) && !byFingerprint.has(r.fingerprint)
  );

  const missing_in_mysql_all = aetheraRows
    .filter((r) => {
      const ext = normalizeMysqlExternalId(String(r.external_id));
      if (mysqlByExternal.has(ext)) return false;
      const fp = deliveryBusinessFingerprint({
        flux_codpes: r.flux_codpes,
        flux_codloc: r.flux_codloc,
        document_number: r.document_number,
        delivered_at: r.delivered_at,
      });
      if (fp && mysqlByFingerprint.has(fp)) return false;
      return true;
    })
    .map((r) => ({
      external_id: String(r.external_id),
      delivered_at: String(r.delivered_at),
      pharmacy_id: String(r.pharmacy_id),
      driver_id: String(r.driver_id),
    }));

  return {
    period_start: start,
    period_end: end,
    mysql_total: mysqlRows.length,
    aethera_flux_db_total: aetheraRows.length,
    missing_in_aethera_count: missing_in_aethera_all.length,
    missing_in_mysql_count: missing_in_mysql_all.length,
    missing_in_aethera: missing_in_aethera_all.slice(0, SAMPLE_LIMIT),
    missing_in_mysql: missing_in_mysql_all.slice(0, SAMPLE_LIMIT),
    _missing_in_aethera_all: missing_in_aethera_all,
  };
}

export async function importMysqlReconcileRows(
  db: SupabaseClient,
  workspaceId: string,
  rows: MysqlReconcileRow[]
): Promise<MysqlImportStats> {
  const stats: MysqlImportStats = {
    imported: 0,
    skipped_unmapped_pharmacy: 0,
    skipped_unmapped_driver: 0,
    skipped_missing_driver_name: 0,
    skipped_duplicate: 0,
  };
  if (!rows.length) return stats;

  const [{ data: pharmacies }, { data: drivers }] = await Promise.all([
    db.from('pharmacies').select('id, cnpj').eq('workspace_id', workspaceId),
    db.from('drivers').select('id, cpf, flux_delivery_driver_id').eq('workspace_id', workspaceId),
  ]);

  const pharmacyIndex = buildPharmacyCnpjIndex(pharmacies || []);
  const driverByFlux = new Map<string, string>();
  const cpfCounts = new Map<string, number>();
  const driverByCpf = new Map<string, string>();
  for (const d of drivers || []) {
    if (d.flux_delivery_driver_id) driverByFlux.set(String(d.flux_delivery_driver_id), String(d.id));
    const cpf = String(d.cpf ?? '').replace(/\D/g, '');
    if (cpf) cpfCounts.set(cpf, (cpfCounts.get(cpf) || 0) + 1);
  }
  for (const d of drivers || []) {
    const cpf = String(d.cpf ?? '').replace(/\D/g, '');
    if (cpf && (cpfCounts.get(cpf) || 0) === 1) driverByCpf.set(cpf, String(d.id));
  }

  const now = new Date().toISOString();
  const inserts: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (!hasMysqlDriverName(row.driver_name)) {
      stats.skipped_missing_driver_name += 1;
      continue;
    }

    const resolvedPharmacy = resolveMysqlDeliveryPharmacyId(
      workspaceId,
      row.codpes,
      row.codloc,
      row.cnpj,
      pharmacyIndex,
      null
    );
    if (!resolvedPharmacy) {
      stats.skipped_unmapped_pharmacy += 1;
      continue;
    }

    const driverId =
      driverByFlux.get(row.driver_flux_id) ||
      (row.driver_cpf && (cpfCounts.get(row.driver_cpf) || 0) === 1 ? driverByCpf.get(row.driver_cpf) : undefined);
    if (!driverId) {
      stats.skipped_unmapped_driver += 1;
      continue;
    }

    inserts.push({
      workspace_id: workspaceId,
      pharmacy_id: resolvedPharmacy.pharmacyId,
      driver_id: driverId,
      delivered_at: row.delivered_at,
      document_number: row.document_number,
      route_id: row.route_id,
      source: 'flux_db',
      // Sem prefixo mysql: — a unicidade é (workspace, source, external_id); source=flux_db já isola da API.
      external_id: row.external_id,
      flux_codpes: row.codpes,
      flux_codloc: row.codloc,
      cancelled: false,
      verified: true,
      updated_at: now,
    });
  }

  if (!inserts.length) return stats;

  for (let i = 0; i < inserts.length; i += IMPORT_CHUNK) {
    const chunk = inserts.slice(i, i + IMPORT_CHUNK);
    const { data, error } = await db
      .from('billing_delivery_records')
      .upsert(chunk, { onConflict: 'workspace_id,source,external_id', ignoreDuplicates: true })
      .select('id');
    if (error) throw new Error(error.message);
    const inserted = (data || []).length;
    stats.imported += inserted;
    stats.skipped_duplicate += Math.max(0, chunk.length - inserted);
  }

  return stats;
}

/** Remove campos internos antes de serializar a resposta HTTP. */
export function publicMysqlReconcileReport(report: MysqlReconcileResult): Omit<MysqlReconcileResult, '_missing_in_aethera_all'> {
  const { _missing_in_aethera_all: _, ...pub } = report;
  return pub;
}
