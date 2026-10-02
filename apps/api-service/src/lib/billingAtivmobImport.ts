import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';

export type AtivmobDeliveryRow = {
  external_id: string;
  pharmacy_cnpj: string;
  pharmacy_ambiente: string;
  driver_name: string;
  delivered_at: string;
  document_number: string;
  route_id: string | null;
  cancelled: boolean;
  value_cents: number | null;
};

export type AtivmobReportMeta = {
  period_start: string;
  period_end: string;
  transportadora: string | null;
  requested_by: string | null;
};

export type ParsedAtivmobReport = {
  meta: AtivmobReportMeta;
  deliveries: AtivmobDeliveryRow[];
  stats: {
    total_rows: number;
    delivered_rows: number;
    skipped_rows: number;
    skipped_not_delivered: number;
    skipped_invalid_dispatch: number;
    skipped_missing_driver: number;
    unique_cnpjs: number;
    unique_drivers: number;
    status_counts: Record<string, number>;
  };
};

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function findAtivmobColumns(headers: string[]) {
  const norm = headers.map((h) => normalizeHeader(h));
  const idx = (pred: (h: string) => boolean) => norm.findIndex(pred);
  return {
    ambiente: idx((h) => h === 'ambiente'),
    cnpj: idx((h) => h === 'cnpj'),
    sol: idx((h) => /^n[°º]?\s*sol/.test(h)),
    pedido: idx((h) => (h.includes('codigo') && h.includes('pedido')) || h === 'pedido'),
    despacho: idx((h) => h === 'despacho' || h.includes('despacho') || (h.includes('data') && h.includes('entrega'))),
    agente: idx((h) => h === 'agente' || h.includes('entregador') || h.includes('motorista')),
    status: idx((h) => h === 'status' || h.includes('ultimo status') || h.includes('status entrega')),
    valor: idx((h) => h.includes('val') && h.includes('sol')),
  };
}

function parseBrDateTime(value: unknown): string | null {
  const s = String(value ?? '').trim();
  if (!s || s === '-') return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const hh = m[4] ?? '12';
  const mm = m[5] ?? '00';
  const ss = m[6] ?? '00';
  return new Date(`${m[3]}-${m[2]}-${m[1]}T${hh}:${mm}:${ss}.000Z`).toISOString();
}

function parseBrPeriodRange(value: unknown): { start: string; end: string } | null {
  const s = String(value ?? '').trim();
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return {
    start: `${m[3]}-${m[2]}-${m[1]}`,
    end: `${m[6]}-${m[5]}-${m[4]}`,
  };
}

function parseBrMoneyCents(value: unknown): number | null {
  const s = String(value ?? '').trim().replace(/\s/g, '');
  if (!s || s === '-') return null;
  const normalized = s.replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function normalizeCnpjDigits(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 13) return digits.padStart(14, '0');
  return digits;
}

function cellText(row: ExcelJS.Row, colIndex: number): string {
  if (colIndex < 0) return '';
  const cell = row.getCell(colIndex + 1).value;
  if (cell == null) return '';
  if (typeof cell === 'object' && cell !== null && 'text' in cell) {
    return String((cell as { text?: string }).text ?? '').trim();
  }
  return String(cell).trim();
}

function rowHeaderValues(row: ExcelJS.Row): string[] {
  const out: string[] = [];
  for (let c = 1; c <= row.cellCount; c++) {
    out.push(normalizeHeader(row.getCell(c).value));
  }
  return out;
}

export async function parseAtivmobReportFromBuffer(buffer: Buffer): Promise<ParsedAtivmobReport> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return parseAtivmobWorkbook(wb);
}

export async function parseAtivmobReportFromPath(filePath: string): Promise<ParsedAtivmobReport> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  return parseAtivmobWorkbook(wb);
}

export async function parseAtivmobReportFromBase64(base64: string): Promise<ParsedAtivmobReport> {
  return parseAtivmobReportFromBuffer(Buffer.from(base64, 'base64'));
}

function parseAtivmobWorkbook(wb: ExcelJS.Workbook): ParsedAtivmobReport {
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Relatório ATIVMOB sem abas');

  let period_start = '';
  let period_end = '';
  let transportadora: string | null = null;
  let requested_by: string | null = null;

  for (let r = 1; r <= Math.min(6, ws.rowCount); r++) {
    const label = normalizeHeader(cellText(ws.getRow(r), 0));
    const value = cellText(ws.getRow(r), 1);
    if (label.includes('periodo')) {
      const range = parseBrPeriodRange(value);
      if (range) {
        period_start = range.start;
        period_end = range.end;
      }
    }
    if (label.includes('solicitacao')) requested_by = value || null;
    if (label.includes('filtro') && value.toLowerCase().includes('transportadoras')) {
      transportadora = value;
    }
  }

  let headerRowIndex = 0;
  for (let r = 1; r <= Math.min(20, ws.rowCount); r++) {
    const headers = rowHeaderValues(ws.getRow(r));
    if (headers.some((h) => h.includes('cnpj')) && headers.some((h) => h.includes('despacho'))) {
      headerRowIndex = r;
      break;
    }
  }
  if (!headerRowIndex) throw new Error('Cabeçalho do relatório ATIVMOB não encontrado');

  const headers = rowHeaderValues(ws.getRow(headerRowIndex));

  const col = findAtivmobColumns(headers);
  const missing = [
    ['CNPJ', col.cnpj],
    ['Despacho', col.despacho],
    ['Agente/Entregador', col.agente],
    ['Status', col.status],
  ].filter(([, index]) => Number(index) < 0);
  if (missing.length) {
    throw new Error(
      `Colunas obrigatórias ausentes no relatório ATIVMOB: ${missing.map(([name]) => name).join(', ')}`
    );
  }

  const deliveries: AtivmobDeliveryRow[] = [];
  const cnpjs = new Set<string>();
  const drivers = new Set<string>();
  let total_rows = 0;
  let skipped_rows = 0;
  let skipped_not_delivered = 0;
  let skipped_invalid_dispatch = 0;
  let skipped_missing_driver = 0;
  const status_counts: Record<string, number> = {};

  for (let r = headerRowIndex + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cnpj = normalizeCnpjDigits(cellText(row, col.cnpj));
    if (!cnpj) continue;
    total_rows += 1;

    const statusRaw = cellText(row, col.status);
    const status = statusRaw.toLowerCase();
    status_counts[statusRaw || '(vazio)'] = (status_counts[statusRaw || '(vazio)'] || 0) + 1;
    const delivered = status.includes('entregue');
    const despacho = parseBrDateTime(cellText(row, col.despacho));
    const driver = cellText(row, col.agente);
    const sol = cellText(row, col.sol);
    const pedido = cellText(row, col.pedido);

    if (!delivered) {
      skipped_rows += 1;
      skipped_not_delivered += 1;
      continue;
    }
    if (!despacho) {
      skipped_rows += 1;
      skipped_invalid_dispatch += 1;
      continue;
    }
    if (!driver) {
      skipped_rows += 1;
      skipped_missing_driver += 1;
      continue;
    }

    const external_id = `ativmob:${pedido || sol || 'na'}:${cnpj}:${despacho.slice(0, 19)}`;
    cnpjs.add(cnpj);
    drivers.add(driver);

    deliveries.push({
      external_id,
      pharmacy_cnpj: cnpj,
      pharmacy_ambiente: cellText(row, col.ambiente),
      driver_name: driver,
      delivered_at: despacho,
      document_number: pedido || sol,
      route_id: sol || null,
      cancelled: false,
      value_cents: parseBrMoneyCents(cellText(row, col.valor)),
    });
  }

  if (!period_start && deliveries.length) {
    const dates = deliveries.map((d) => d.delivered_at.slice(0, 10)).sort();
    period_start = dates[0];
    period_end = dates[dates.length - 1];
  }

  return {
    meta: {
      period_start,
      period_end,
      transportadora,
      requested_by,
    },
    deliveries,
    stats: {
      total_rows,
      delivered_rows: deliveries.length,
      skipped_rows,
      skipped_not_delivered,
      skipped_invalid_dispatch,
      skipped_missing_driver,
      unique_cnpjs: cnpjs.size,
      unique_drivers: drivers.size,
      status_counts,
    },
  };
}

export function ativmobReportSummary(report: ParsedAtivmobReport): Record<string, unknown> {
  return {
    period: `${report.meta.period_start} → ${report.meta.period_end}`,
    transportadora: report.meta.transportadora,
    stats: report.stats,
  };
}
