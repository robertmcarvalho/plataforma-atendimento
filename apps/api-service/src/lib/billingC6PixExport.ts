import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import type { PixBatchRow } from './billingPayablesEngine';

const TEMPLATE_FILE = 'c6-template-pagar-salarios-via-pix.xlsx';
const PIX_KEY_SHEET_INDEX = 1;
const DATA_START_ROW = 3;
/** Formato de data aceito pelo C6 / Excel BR — evita serial cru sem numFmt. */
const C6_DATE_NUM_FMT = 'dd/mm/yyyy';

const NON_PHONE_PIX_TYPES = new Set([
  'cpf',
  'cnpj',
  'email',
  'random',
  'evp',
  'chave_aleatoria',
  'aleatoria',
]);

const PHONE_PIX_TYPES = new Set(['phone', 'celular', 'telefone', 'mobile']);

function templatePath(): string {
  const candidates = [
    process.env.BILLING_C6_PIX_TEMPLATE_PATH,
    // Cloud Run / monorepo runner: cwd=/app, assets em /app/assets
    path.join(process.cwd(), 'assets', 'billing', TEMPLATE_FILE),
    // apps/api-service Dockerfile (cwd=/app, dist em /app/dist)
    path.join(__dirname, '..', 'assets', 'billing', TEMPLATE_FILE),
    // Dev: src/lib → ../../assets/billing
    path.join(__dirname, '..', '..', 'assets', 'billing', TEMPLATE_FILE),
    path.join(process.cwd(), 'c6-template-pagar-salarios-via-pix.xlsx'),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Template C6 PIX não encontrado (assets/billing/${TEMPLATE_FILE}). Verifique se a imagem Cloud Run inclui /app/assets.`
  );
}

/**
 * Normaliza chave PIX para importação C6.
 * CPF/CNPJ/email/EVP nunca recebem +55. Só phone/celular/telefone.
 * Sem tipo: 11 dígitos = CPF; 10 dígitos = telefone com DDD.
 */
export function formatC6PixKey(pixKey: string | null, pixKeyType: string | null): string {
  if (!pixKey) return '';
  const key = pixKey.trim();
  const type = (pixKeyType || '').toLowerCase().trim();
  const digits = key.replace(/\D/g, '');

  if (NON_PHONE_PIX_TYPES.has(type) || key.includes('@')) {
    return key;
  }

  if (PHONE_PIX_TYPES.has(type)) {
    return normalizeC6PhoneKey(key, digits);
  }

  // Tipo ausente / desconhecido: não tratar 11 dígitos como telefone (CPF no BR).
  if (digits.length === 11) {
    return key;
  }
  if (digits.length === 10) {
    return normalizeC6PhoneKey(key, digits);
  }
  if (digits.length >= 12 && digits.startsWith('55')) {
    return key.startsWith('+') ? key : `+${digits}`;
  }
  return key;
}

function normalizeC6PhoneKey(key: string, digits: string): string {
  if (key.startsWith('+')) return key;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if (digits.length >= 12 && digits.startsWith('55')) return `+${digits}`;
  return key;
}

export function resolveCyclePaymentDateIso(paymentDate: string | null | undefined, apuracaoEnd: string): string {
  if (paymentDate) return String(paymentDate).slice(0, 10);
  const d = new Date(`${String(apuracaoEnd).slice(0, 10)}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

function toC6PaymentDate(isoDate: string): Date {
  return new Date(`${isoDate.slice(0, 10)}T12:00:00.000Z`);
}

function setC6PaymentDateCell(cell: ExcelJS.Cell, isoDate: string): void {
  cell.value = toC6PaymentDate(isoDate);
  cell.numFmt = C6_DATE_NUM_FMT;
}

function clearDataRow(row: ExcelJS.Row): void {
  for (let c = 1; c <= 5; c += 1) {
    const cell = row.getCell(c);
    cell.value = null;
    // Evita sobras de serial numérico sem formato de data em linhas do template.
    if (c === 4) cell.numFmt = C6_DATE_NUM_FMT;
  }
}

export type BuildC6PixBatchOptions = {
  /** Descrição fixa na coluna (ex.: REPASSE DIARIAS). Sobrescreve cycleLabel. */
  description?: string;
};

/** Limite do internet banking C6 para upload de planilha PIX em lote. */
export const C6_PIX_MAX_PAYMENTS_PER_FILE = 100;

/** Divide pagamentos em fatias de no máximo `size` (padrão 100) para múltiplos XLSX C6. */
export function chunkRowsForC6PixFile<T>(rows: T[], size = C6_PIX_MAX_PAYMENTS_PER_FILE): T[][] {
  const limit = Math.max(1, Math.floor(size));
  if (!rows.length) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += limit) {
    chunks.push(rows.slice(i, i + limit));
  }
  return chunks;
}

/** Sufixo de arquivo quando há mais de uma parte (`-parte1de3`). */
export function c6PixPartFilenameSuffix(partIndex: number, partCount: number): string {
  if (partCount <= 1) return '';
  return `-parte${partIndex + 1}de${partCount}`;
}

export async function buildC6PixBatchXlsx(
  rows: PixBatchRow[],
  cycleLabel: string | null,
  paymentDateIso: string,
  options?: BuildC6PixBatchOptions
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath());

  const sheet = workbook.worksheets[PIX_KEY_SHEET_INDEX];
  if (!sheet) throw new Error('Aba "PIX chave ou código" do template C6 não encontrada');

  const desc =
    options?.description ??
    (cycleLabel ? `Repasse ciclo ${cycleLabel}` : 'Repasse cooperado');
  const exportable = rows.filter((r) => !r.warnings.includes('PIX não cadastrado'));
  if (exportable.length > C6_PIX_MAX_PAYMENTS_PER_FILE) {
    throw new Error(
      `Lote C6 excede ${C6_PIX_MAX_PAYMENTS_PER_FILE} pagamentos (${exportable.length}). Use chunkRowsForC6PixFile antes de gerar o XLSX.`
    );
  }
  const fallbackIso = paymentDateIso.slice(0, 10);

  for (let r = DATA_START_ROW; r <= sheet.rowCount; r += 1) {
    clearDataRow(sheet.getRow(r));
  }

  let rowIdx = DATA_START_ROW;
  for (const row of exportable) {
    const excelRow = sheet.getRow(rowIdx);
    excelRow.getCell(1).value = row.name;
    excelRow.getCell(2).value = formatC6PixKey(row.pix_key, row.pix_key_type);
    excelRow.getCell(3).value = row.amount_cents / 100;
    const iso = row.payment_date ? String(row.payment_date).slice(0, 10) : fallbackIso;
    setC6PaymentDateCell(excelRow.getCell(4), iso);
    excelRow.getCell(5).value = desc;
    rowIdx += 1;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
