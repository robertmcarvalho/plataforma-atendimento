export function onlyDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function pickField(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const v = row[key];
    if (v != null && String(v).trim() !== '') return v;
  }
  return null;
}

export function parseFluxCodPes(row: Record<string, unknown>): number | null {
  const raw = pickField(row, ['codPes', 'codpes', 'Codpes', 'codPES']);
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function parseFluxCodLoc(row: Record<string, unknown>): number | null {
  const raw = pickField(row, ['codLoc', 'codloc', 'Codloc', 'codLOC', 'idLoja', 'id_loja']);
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function normalizeFluxCnpjDigits(value: unknown): string {
  const digits = onlyDigits(value);
  if (!digits) return '';
  if (digits.length === 13) return digits.padStart(14, '0');
  return digits;
}

export function parseFluxCnpj(row: Record<string, unknown>): string | null {
  const digits = normalizeFluxCnpjDigits(pickField(row, ['cnpj', 'cnpjFarmacia', 'cnpjLoc', 'CNPJLoc', 'cnpjLoja']));
  return digits.length >= 11 ? digits : null;
}

export function parseFluxDriverId(row: Record<string, unknown>): string | null {
  const raw = pickField(row, ['idEntregador', 'idEntr', 'IDEntr', 'id_entregador']);
  const s = String(raw ?? '').trim();
  return s || null;
}

/** CPF do entregador quando presente no payload (entregas costumam não trazer; entregadores sim). */
export function parseFluxDriverCpf(row: Record<string, unknown>): string | null {
  const digits = onlyDigits(
    pickField(row, [
      'cpfEntregador',
      'cpf_entregador',
      'CPFEntr',
      'cpfEntr',
      'cpf',
      'documentoEntregador',
      'documento_entregador',
    ])
  );
  return digits.length >= 11 ? digits : null;
}

/** Flux/MySQL datetimes without timezone are local America/Sao_Paulo (BRT). */
export const FLUX_SOURCE_TIMEZONE = 'America/Sao_Paulo';

function hasExplicitTimezone(value: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value.trim());
}

/** Convert a timezone-less local datetime in America/Sao_Paulo to UTC ISO. */
export function fluxLocalDateTimeToUtcIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone = FLUX_SOURCE_TIMEZONE
): string {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(utcGuess));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value);
  const asLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offset = asLocal - utcGuess;
  return new Date(utcGuess - offset).toISOString();
}

/** Parse `YYYY-MM-DDTHH:mm:ss` (no zone) as Flux local time → UTC ISO. */
export function fluxLocalIsoDateTimeToUtcIso(value: string, timeZone = FLUX_SOURCE_TIMEZONE): string | null {
  const m = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return fluxLocalDateTimeToUtcIso(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
    timeZone
  );
}

export function parseFluxDeliveryAt(row: Record<string, unknown>): string | null {
  const raw = pickField(row, [
    'dataEntrega',
    'dataRecebimento',
    'finalizadaEm',
    'entregueEm',
    'pedidoRecebidoEm',
    'dataHoraEntrega',
    'datHorEnt',
    'dataHora',
    'deliveredAt',
    'data_entrega',
  ]);
  if (!raw) return null;
  const s = String(raw).trim();
  if (s.includes('T')) {
    if (hasExplicitTimezone(s)) {
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    const fromIso = fluxLocalIsoDateTimeToUtcIso(s);
    if (fromIso) return fromIso;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const isoDateTime = s.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?/);
  if (isoDateTime) {
    return fluxLocalDateTimeToUtcIso(
      Number(isoDateTime[1]),
      Number(isoDateTime[2]),
      Number(isoDateTime[3]),
      Number(isoDateTime[4]),
      Number(isoDateTime[5]),
      Number(isoDateTime[6] ?? 0)
    );
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return fluxLocalDateTimeToUtcIso(Number(m[1]), Number(m[2]), Number(m[3]), 12, 0, 0);
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (br) {
    return fluxLocalDateTimeToUtcIso(
      Number(br[3]),
      Number(br[2]),
      Number(br[1]),
      Number(br[4] ?? 12),
      Number(br[5] ?? 0),
      Number(br[6] ?? 0)
    );
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseFluxDocumentNumber(row: Record<string, unknown>): string | null {
  const raw = pickField(row, ['numeroDocumento', 'nroDocto', 'nroDoc', 'NroDocto', 'documento', 'idEntrega', 'id']);
  const s = String(raw ?? '').trim();
  return s || null;
}

export function parseFluxRouteId(row: Record<string, unknown>): string | null {
  const raw = pickField(row, ['idRota', 'IDRota', 'id_rota', 'routeId', 'idLoja']);
  const s = String(raw ?? '').trim();
  return s || null;
}

export function parseFluxDeliveryExternalKey(row: Record<string, unknown>): string | null {
  const idEntrega = pickField(row, ['idEntrega', 'IDEntrega', 'id_entrega', 'id']);
  if (idEntrega != null && String(idEntrega).trim()) {
    const codpes = parseFluxCodPes(row);
    const codloc = parseFluxCodLoc(row);
    if (codloc != null) return `${codpes ?? 0}:${codloc}:${idEntrega}`;
    return String(idEntrega).trim();
  }
  const codpes = parseFluxCodPes(row);
  const codloc = parseFluxCodLoc(row);
  const driver = parseFluxDriverId(row);
  const doc = parseFluxDocumentNumber(row);
  const at = parseFluxDeliveryAt(row);
  if (codpes != null && codloc != null && driver && at) {
    return `${codpes}:${codloc}:${driver}:${doc || 'na'}:${at.slice(0, 19)}`;
  }
  return null;
}

export function fluxPharmacyKey(codpes: number, codloc: number): string {
  return `${codpes}:${codloc}`;
}
