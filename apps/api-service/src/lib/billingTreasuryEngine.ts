import { createHash, randomUUID } from 'node:crypto';
import { supabase } from './supabase';
import { addBillingAuditNotification } from './billingAuditNotifications';
import { generateDriverPayablesFromCycle } from './billingPayablesEngine';

export type BankMovementImportRow = {
  movement_date: string;
  amount_cents: number;
  direction: 'credit' | 'debit';
  description: string | null;
  external_id: string | null;
};

export type BankStatementFormat = 'csv' | 'ofx' | 'cora' | 'c6' | 'cora_api';

export type PixExportTemplate =
  | 'generic'
  | 'itau'
  | 'bradesco'
  | 'santander'
  | 'bb'
  | 'inter'
  | 'nubank'
  | 'c6';

function stripBom(content: string): string {
  return content.replace(/^\uFEFF/, '');
}

function parseBrDate(raw: string): string | null {
  const t = raw.trim();
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const br2 = t.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (br2) {
    const yy = Number(br2[3]);
    const year = yy >= 70 ? 1900 + yy : 2000 + yy;
    return `${year}-${br2[2]}-${br2[1]}`;
  }
  return null;
}

const BANK_IMPORT_CHUNK_SIZE = 100;
const BANK_EXISTING_LOOKUP_CHUNK = 200;
const BANK_AUTO_RECONCILE_MAX = 200;

function isUniqueViolation(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === '23505') return true;
  return /duplicate key|unique constraint/i.test(String(err.message || ''));
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function parseBrMoney(raw: string): number | null {
  const stripped = raw.trim().replace(/[^\d,.-]/g, '');
  const hasComma = stripped.includes(',');
  const hasDecimalDot = /\.\d{1,2}$/.test(stripped);
  const cleaned = hasComma
    ? stripped.replace(/\./g, '').replace(',', '.')
    : hasDecimalDot
      ? stripped
      : stripped.replace(/\./g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.abs(n) * 100);
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out.map((c) => c.replace(/^"|"$/g, '').trim());
}

function normalizeText(raw: string | null | undefined): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Logical content key (stable across overlapping statement windows / reimports). */
export function bankMovementContentBaseKey(row: {
  movement_date: string;
  amount_cents: number;
  direction: string;
  description?: string | null;
}): string {
  return `${row.movement_date}|${row.amount_cents}|${row.direction}|${normalizeText(row.description)}`;
}

/**
 * Stable external_id: content fingerprint + occurrence within the same content key.
 * Do NOT include absolute file line indexes — overlapping C6 exports shift line numbers
 * and previously caused full-file duplicate imports.
 */
export function bankMovementExternalId(
  prefix: string,
  row: {
    movement_date: string;
    amount_cents: number;
    direction: string;
    description?: string | null;
  },
  occurrence: number
): string {
  return createHash('sha1')
    .update(`${prefix}|${bankMovementContentBaseKey(row)}|${occurrence}`)
    .digest('hex');
}

function assignStableExternalIds(
  prefix: string,
  rows: Array<Omit<BankMovementImportRow, 'external_id'> & { external_id?: string | null }>
): BankMovementImportRow[] {
  const occurrenceByKey = new Map<string, number>();
  return rows.map((row) => {
    const base = bankMovementContentBaseKey(row);
    const occurrence = occurrenceByKey.get(base) || 0;
    occurrenceByKey.set(base, occurrence + 1);
    return {
      movement_date: row.movement_date,
      amount_cents: row.amount_cents,
      direction: row.direction,
      description: row.description ?? null,
      external_id: bankMovementExternalId(prefix, row, occurrence),
    };
  });
}

function textScore(statementText: string | null | undefined, candidateText: string | null | undefined): number {
  const source = normalizeText(statementText);
  const candidate = normalizeText(candidateText);
  if (!source || !candidate) return 0;
  if (source.includes(candidate) || candidate.includes(source)) return 30;
  const sourceTokens = new Set(source.split(' ').filter((t) => t.length > 2));
  const candidateTokens = candidate.split(' ').filter((t) => t.length > 2);
  if (!candidateTokens.length) return 0;
  const hits = candidateTokens.filter((t) => sourceTokens.has(t)).length;
  return Math.round((hits / candidateTokens.length) * 30);
}

function daysBetween(a: string, b: string): number {
  const da = new Date(`${a.slice(0, 10)}T12:00:00.000Z`).getTime();
  const db = new Date(`${b.slice(0, 10)}T12:00:00.000Z`).getTime();
  return Math.abs(Math.round((da - db) / 86_400_000));
}

/** Conta corrente C6: Data Lançamento + Entrada/Saída. */
export function looksLikeC6AccountBankStatement(content: string): boolean {
  const lines = stripBom(content).split(/\r?\n/).filter((line) => line.trim());
  return lines.some((line) => {
    const n = normalizeText(line);
    return (
      (n.startsWith('data lancamento') && n.includes('data contabil') && n.includes('titulo')) ||
      (n.includes('data lancamento') && n.includes('entrada r') && n.includes('saida r'))
    );
  });
}

/**
 * Extrato de lote de pagamentos C6 (PIX em massa):
 * "EXTRATO DO LOTE C6 BANK" + cabeçalho Data Pagamento / Tipo e Beneficiário / Valor.
 */
export function looksLikeC6LoteBankStatement(content: string): boolean {
  const lines = stripBom(content).split(/\r?\n/).filter((line) => line.trim());
  return lines.some((line) => {
    const n = normalizeText(line);
    return (
      n.includes('data pagamento') &&
      n.includes('valor') &&
      (n.includes('tipo e beneficiario') || n.includes('beneficiario'))
    );
  });
}

export function looksLikeC6BankStatement(content: string): boolean {
  return looksLikeC6AccountBankStatement(content) || looksLikeC6LoteBankStatement(content);
}

export function looksLikeCoraBankStatement(content: string): boolean {
  const lines = stripBom(content).split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return false;
  const header = normalizeText(parseCsvLine(lines[0]).join(' '));
  return header.includes('tipo transacao') && (header.includes('identificacao') || header.includes('transacao'));
}

/** When UI sends generic `csv`, promote to C6/Cora if header matches. Explicit formats stay as requested. */
export function resolveBankStatementFormat(content: string, format: BankStatementFormat): BankStatementFormat {
  if (format === 'ofx' || format === 'c6' || format === 'cora') return format;
  if (looksLikeC6BankStatement(content)) return 'c6';
  if (looksLikeCoraBankStatement(content)) return 'cora';
  return 'csv';
}

export function summarizeBankMovementRows(rows: BankMovementImportRow[]): {
  total: number;
  by_date: Record<string, number>;
} {
  const by_date: Record<string, number> = {};
  for (const row of rows) {
    by_date[row.movement_date] = (by_date[row.movement_date] || 0) + 1;
  }
  return { total: rows.length, by_date };
}

export function parseBankCsv(content: string): BankMovementImportRow[] {
  const lines = stripBom(content).split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const header = lines[0].split(/[;,]/).map((h) => normalizeText(h));
  const idxDate = header.findIndex((h) => ['data', 'date', 'dt', 'movimento'].includes(h));
  const idxValue = header.findIndex((h) => ['valor', 'value', 'amount', 'vlr'].includes(h));
  const idxDesc = header.findIndex((h) => ['descricao', 'description', 'historico'].includes(h));
  const idxType = header.findIndex((h) => ['tipo', 'type', 'dc', 'credito_debito'].includes(h));

  const parsed: Array<Omit<BankMovementImportRow, 'external_id'>> = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split(/[;,]/).map((c) => c.trim().replace(/^"|"$/g, ''));
    const date = idxDate >= 0 ? parseBrDate(cols[idxDate] || '') : null;
    const amount = idxValue >= 0 ? parseBrMoney(cols[idxValue] || '') : null;
    if (!date || !amount || amount <= 0) continue;

    let direction: 'credit' | 'debit' = 'debit';
    if (idxType >= 0) {
      const t = (cols[idxType] || '').toLowerCase();
      direction = t.startsWith('c') || t.includes('cred') || t === '+' ? 'credit' : 'debit';
    } else if (idxValue >= 0 && /-/.test(cols[idxValue])) {
      direction = 'debit';
    }

    const desc = idxDesc >= 0 ? cols[idxDesc] || null : null;
    parsed.push({ movement_date: date, amount_cents: amount, direction, description: desc });
  }
  return assignStableExternalIds('csv', parsed);
}

export function parseCoraBankStatement(content: string): BankMovementImportRow[] {
  const lines = stripBom(content).split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map((h) => normalizeText(h));
  const idxDate = header.findIndex((h) => h === 'data');
  const idxTransaction = header.findIndex((h) => h === 'transacao');
  const idxType = header.findIndex((h) => h === 'tipo transacao');
  const idxId = header.findIndex((h) => h === 'identificacao');
  const idxValue = header.findIndex((h) => h === 'valor');
  if (idxDate < 0 || idxType < 0 || idxValue < 0) return [];

  const parsed: BankMovementImportRow[] = [];
  const occurrenceByKey = new Map<string, number>();
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const date = parseBrDate(cols[idxDate] || '');
    const amount = parseBrMoney(cols[idxValue] || '');
    if (!date || !amount) continue;
    const type = normalizeText(cols[idxType] || '');
    const direction: 'credit' | 'debit' = type.includes('credito') ? 'credit' : 'debit';
    const transaction = cols[idxTransaction] || '';
    const identification = (cols[idxId] || '').trim();
    const description = [transaction, identification].filter(Boolean).join(' — ') || null;
    if (identification) {
      parsed.push({
        movement_date: date,
        amount_cents: amount,
        direction,
        description,
        external_id: `cora:${identification}`,
      });
      continue;
    }
    const row = { movement_date: date, amount_cents: amount, direction, description };
    const base = bankMovementContentBaseKey(row);
    const occurrence = occurrenceByKey.get(base) || 0;
    occurrenceByKey.set(base, occurrence + 1);
    parsed.push({ ...row, external_id: bankMovementExternalId('cora', row, occurrence) });
  }
  return parsed;
}

function parseC6AccountBankStatement(content: string): BankMovementImportRow[] {
  const lines = stripBom(content).split(/\r?\n/).filter((line) => line.trim());
  const headerIndex = lines.findIndex((line) => {
    const n = normalizeText(line);
    return (
      n.startsWith('data lancamento data contabil titulo') ||
      (n.includes('data lancamento') && n.includes('entrada r') && n.includes('saida r'))
    );
  });
  if (headerIndex < 0) return [];
  const header = parseCsvLine(lines[headerIndex]).map((h) => normalizeText(h));
  const idxDate = header.findIndex((h) => h === 'data lancamento');
  const idxTitle = header.findIndex((h) => h === 'titulo');
  const idxDesc = header.findIndex((h) => h === 'descricao');
  const idxIn = header.findIndex((h) => h === 'entrada r' || h.startsWith('entrada r'));
  const idxOut = header.findIndex((h) => h === 'saida r' || h.startsWith('saida r'));
  if (idxDate < 0 || idxIn < 0 || idxOut < 0) return [];

  const parsed: Array<Omit<BankMovementImportRow, 'external_id'>> = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const date = parseBrDate(cols[idxDate] || '');
    const inAmount = parseBrMoney(cols[idxIn] || '');
    const outAmount = parseBrMoney(cols[idxOut] || '');
    if (!date) continue;
    const amount = inAmount && inAmount > 0 ? inAmount : outAmount && outAmount > 0 ? outAmount : null;
    if (!amount) continue;
    const direction: 'credit' | 'debit' = inAmount && inAmount > 0 ? 'credit' : 'debit';
    const description = [cols[idxTitle] || '', cols[idxDesc] || ''].filter(Boolean).join(' — ') || null;
    parsed.push({ movement_date: date, amount_cents: amount, direction, description });
  }
  return assignStableExternalIds('c6', parsed);
}

/** Pagamentos de lote C6 (saídas PIX). Só importa linhas com status Pago (ou sem status). */
function parseC6LoteBankStatement(content: string): BankMovementImportRow[] {
  const lines = stripBom(content).split(/\r?\n/).filter((line) => line.trim());
  const headerIndex = lines.findIndex((line) => {
    const n = normalizeText(line);
    return (
      n.includes('data pagamento') &&
      n.includes('valor') &&
      (n.includes('tipo e beneficiario') || n.includes('beneficiario'))
    );
  });
  if (headerIndex < 0) return [];
  const header = parseCsvLine(lines[headerIndex]).map((h) => normalizeText(h));
  const idxDate = header.findIndex((h) => h === 'data pagamento');
  const idxStatus = header.findIndex((h) => h === 'status');
  const idxBeneficiary = header.findIndex(
    (h) => h === 'tipo e beneficiario' || h.includes('beneficiario')
  );
  const idxValue = header.findIndex((h) => h === 'valor');
  if (idxDate < 0 || idxValue < 0) return [];

  const parsed: Array<Omit<BankMovementImportRow, 'external_id'>> = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const date = parseBrDate(cols[idxDate] || '');
    const amount = parseBrMoney(cols[idxValue] || '');
    if (!date || !amount || amount <= 0) continue;
    if (idxStatus >= 0) {
      const status = normalizeText(cols[idxStatus] || '');
      if (status && status !== 'pago') continue;
    }
    const description = (idxBeneficiary >= 0 ? cols[idxBeneficiary] || '' : '').trim() || null;
    // Lote = pagamentos enviados → débito na conta
    parsed.push({ movement_date: date, amount_cents: amount, direction: 'debit', description });
  }
  return assignStableExternalIds('c6-lote', parsed);
}

export function parseC6BankStatement(content: string): BankMovementImportRow[] {
  if (looksLikeC6LoteBankStatement(content)) return parseC6LoteBankStatement(content);
  return parseC6AccountBankStatement(content);
}

export function parseBankStatement(content: string, format: BankStatementFormat): BankMovementImportRow[] {
  const resolved = resolveBankStatementFormat(content, format);
  if (resolved === 'ofx') return parseOfxBankStatement(content);
  if (resolved === 'cora') return parseCoraBankStatement(content);
  if (resolved === 'c6') return parseC6BankStatement(content);
  return parseBankCsv(content);
}

export function parseOfxBankStatement(content: string): BankMovementImportRow[] {
  const rows: BankMovementImportRow[] = [];
  const blocks = content.split(/<STMTTRN>/i).slice(1);
  for (const block of blocks) {
    const dt = block.match(/<DTPOSTED>(\d{8})/i)?.[1];
    const amtRaw = block.match(/<TRNAMT>([-\d.]+)/i)?.[1];
    const memo = block.match(/<MEMO>([^<\n]+)/i)?.[1]?.trim() || null;
    const fitId = block.match(/<FITID>([^<\n]+)/i)?.[1]?.trim() || null;
    if (!dt || !amtRaw) continue;
    const amount = Math.round(Math.abs(Number(amtRaw)) * 100);
    if (!amount) continue;
    const movement_date = `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`;
    const direction: 'credit' | 'debit' = Number(amtRaw) < 0 ? 'debit' : 'credit';
    rows.push({
      movement_date,
      amount_cents: amount,
      direction,
      description: memo,
      external_id: fitId,
    });
  }
  return rows;
}

export async function importBankMovements(
  workspaceId: string,
  bankAccountId: string,
  rows: BankMovementImportRow[],
  source: BankStatementFormat
): Promise<{ imported: number; skipped: number; batch_id: string; movement_ids: string[] }> {
  const batchId = randomUUID();
  const now = new Date().toISOString();
  const movementIds: string[] = [];
  let imported = 0;
  let skipped = 0;

  const existingExternalIds = new Set<string>();
  const externalIds = rows.map((r) => r.external_id).filter((id): id is string => Boolean(id));
  for (const idChunk of chunkArray(externalIds, BANK_EXISTING_LOOKUP_CHUNK)) {
    const { data, error } = await supabase
      .from('billing_bank_movements')
      .select('external_id')
      .eq('bank_account_id', bankAccountId)
      .in('external_id', idChunk);
    if (error) {
      throw new Error(`Falha ao verificar movimentos já importados: ${error.message}`);
    }
    for (const row of data || []) {
      if (row.external_id) existingExternalIds.add(String(row.external_id));
    }
  }

  // Secondary dedupe by logical content — covers legacy external_ids that included
  // absolute file line indexes (unstable across overlapping C6 statement windows).
  const existingContentKeys = new Set<string>();
  const dates = rows.map((r) => r.movement_date).filter(Boolean).sort();
  if (dates.length) {
    const minDate = dates[0];
    const maxDate = dates[dates.length - 1];
    const pageSize = 1000;
    let from = 0;
    const existingRows: Array<{
      movement_date: string;
      amount_cents: number;
      direction: string;
      description: string | null;
      created_at?: string;
      id?: string;
    }> = [];
    for (;;) {
      const { data, error } = await supabase
        .from('billing_bank_movements')
        .select('id, movement_date, amount_cents, direction, description, created_at')
        .eq('bank_account_id', bankAccountId)
        .gte('movement_date', minDate)
        .lte('movement_date', maxDate)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) {
        throw new Error(`Falha ao verificar movimentos por conteúdo: ${error.message}`);
      }
      existingRows.push(...(data || []));
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }
    const occ = new Map<string, number>();
    for (const row of existingRows) {
      const base = bankMovementContentBaseKey(row);
      const n = occ.get(base) || 0;
      occ.set(base, n + 1);
      existingContentKeys.add(`${base}|${n}`);
    }
  }

  const incomingOcc = new Map<string, number>();
  const toInsert: BankMovementImportRow[] = [];
  for (const row of rows) {
    if (row.external_id && existingExternalIds.has(row.external_id)) {
      skipped += 1;
      continue;
    }
    const base = bankMovementContentBaseKey(row);
    const occurrence = incomingOcc.get(base) || 0;
    incomingOcc.set(base, occurrence + 1);
    const contentKey = `${base}|${occurrence}`;
    if (existingContentKeys.has(contentKey)) {
      skipped += 1;
      continue;
    }
    // Reserve the content key so duplicates inside the same upload are collapsed.
    existingContentKeys.add(contentKey);
    toInsert.push(row);
  }

  const insertOne = async (row: BankMovementImportRow) => {
    const { data, error } = await supabase
      .from('billing_bank_movements')
      .insert({
        workspace_id: workspaceId,
        bank_account_id: bankAccountId,
        movement_date: row.movement_date,
        amount_cents: row.amount_cents,
        direction: row.direction,
        description: row.description,
        external_id: row.external_id,
        source,
        import_batch_id: batchId,
        updated_at: now,
      })
      .select('id')
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        skipped += 1;
        return;
      }
      throw error;
    }
    movementIds.push(String(data.id));
    imported += 1;
  };

  for (const chunk of chunkArray(toInsert, BANK_IMPORT_CHUNK_SIZE)) {
    const payload = chunk.map((row) => ({
      workspace_id: workspaceId,
      bank_account_id: bankAccountId,
      movement_date: row.movement_date,
      amount_cents: row.amount_cents,
      direction: row.direction,
      description: row.description,
      external_id: row.external_id,
      source,
      import_batch_id: batchId,
      updated_at: now,
    }));

    const { data, error } = await supabase.from('billing_bank_movements').insert(payload).select('id');
    if (!error) {
      for (const row of data || []) movementIds.push(String(row.id));
      imported += (data || []).length;
      continue;
    }

    if (!isUniqueViolation(error)) {
      throw new Error(
        `Importação interrompida após ${imported} novo(s) e ${skipped} já existente(s). ` +
          `Reimporte o mesmo arquivo para continuar — duplicados por external_id serão ignorados. Detalhe: ${error.message}`
      );
    }

    // Race / partial unique clash: finish this chunk row-by-row so progress is kept.
    for (const row of chunk) {
      try {
        await insertOne(row);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Importação interrompida após ${imported} novo(s) e ${skipped} já existente(s). ` +
            `Reimporte o mesmo arquivo para continuar — duplicados por external_id serão ignorados. Detalhe: ${message}`
        );
      }
    }
  }

  return { imported, skipped, batch_id: batchId, movement_ids: movementIds };
}

async function notifyBankMovement(
  workspaceId: string,
  input: {
    movementId: string;
    paymentId?: string | null;
    invoiceId?: string | null;
    code: 'BANK_MOVEMENT_UNRECONCILED' | 'BANK_MATCH_REVIEW_REQUIRED' | 'PAYMENT_WITHOUT_BANK_MOVEMENT';
    title: string;
    message: string;
    metadata?: Record<string, unknown>;
  }
) {
  await addBillingAuditNotification({
    workspaceId,
    severity: input.code === 'BANK_MOVEMENT_UNRECONCILED' ? 'warning' : 'info',
    code: input.code,
    title: input.title,
    message: input.message,
    metadata: {
      bank_movement_id: input.movementId,
      payment_id: input.paymentId || null,
      invoice_id: input.invoiceId || null,
      target_route: '/billing/conciliacao',
      ...(input.metadata || {}),
    },
  });
}

async function notifyPaymentWithoutMovement(
  workspaceId: string,
  payment: { id: string; amount_cents: number; paid_at: string; payable_id?: string | null; invoice_id?: string | null }
) {
  await addBillingAuditNotification({
    workspaceId,
    severity: 'warning',
    code: 'PAYMENT_WITHOUT_BANK_MOVEMENT',
    title: 'Baixa sem movimento bancário',
    message: `Baixa de ${payment.amount_cents / 100} em ${String(payment.paid_at).slice(0, 10)} ainda não possui movimento conciliado no extrato importado.`,
    metadata: {
      payment_id: payment.id,
      payable_id: payment.payable_id || null,
      invoice_id: payment.invoice_id || null,
      target_route: '/billing/conciliacao',
    },
  });
}

async function autoReconcileDebitMovement(workspaceId: string, movement: {
  id: string;
  bank_account_id: string;
  movement_date: string;
  amount_cents: number;
  description: string | null;
}) {
  const start = new Date(`${movement.movement_date}T12:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 3);
  const end = new Date(`${movement.movement_date}T12:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 3);
  const { data, error } = await supabase
    .from('billing_payments')
    .select('id, amount_cents, paid_at, payment_method, bank_account_id, payable_id, billing_payables(id, description, beneficiary_type)')
    .eq('workspace_id', workspaceId)
    .eq('reconciled', false)
    .eq('amount_cents', movement.amount_cents)
    .gte('paid_at', start.toISOString())
    .lte('paid_at', end.toISOString())
    .limit(20);
  if (error) throw new Error(error.message);
  const candidates = (data || []).map((payment) => {
    const payableRaw = payment.billing_payables as { description?: string | null; beneficiary_type?: string | null } | { description?: string | null; beneficiary_type?: string | null }[] | null;
    const payable = Array.isArray(payableRaw) ? payableRaw[0] : payableRaw;
    const dateScore = Math.max(0, 20 - daysBetween(movement.movement_date, String(payment.paid_at).slice(0, 10)) * 5);
    const descriptionScore = textScore(movement.description, `${payable?.description || ''} ${payable?.beneficiary_type || ''}`);
    return { payment, score: 60 + dateScore + descriptionScore };
  }).sort((a, b) => b.score - a.score);

  if (candidates.length === 1 && candidates[0].score >= 80) {
    await reconcileBankMovement(workspaceId, movement.id, String(candidates[0].payment.id));
    return { status: 'auto_reconciled' as const, payment_id: String(candidates[0].payment.id), score: candidates[0].score };
  }
  if (candidates.length) {
    await notifyBankMovement(workspaceId, {
      movementId: movement.id,
      paymentId: String(candidates[0].payment.id),
      code: 'BANK_MATCH_REVIEW_REQUIRED',
      title: 'Conciliação bancária precisa de revisão',
      message: `Movimento de débito ${movement.description || ''} possui candidato provável, mas requer confirmação do operador.`,
      metadata: { candidate_count: candidates.length, match_confidence: candidates[0].score },
    });
    return { status: 'review_required' as const, payment_id: String(candidates[0].payment.id), score: candidates[0].score };
  }
  await notifyBankMovement(workspaceId, {
    movementId: movement.id,
    code: 'BANK_MOVEMENT_UNRECONCILED',
    title: 'Movimento bancário sem conciliação',
    message: `Débito de ${movement.amount_cents / 100} em ${movement.movement_date} não encontrou baixa correspondente.`,
  });
  return { status: 'unmatched' as const };
}

async function autoReconcileCreditMovement(workspaceId: string, movement: {
  id: string;
  bank_account_id: string;
  movement_date: string;
  amount_cents: number;
  description: string | null;
}) {
  const start = new Date(`${movement.movement_date}T12:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - 3);
  const end = new Date(`${movement.movement_date}T12:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 3);
  const { data: pendingPayments, error: pendingErr } = await supabase
    .from('billing_payments')
    .select('id, amount_cents, paid_at, invoice_id, billing_invoices(id, pharmacies(id, trade_name, legal_name))')
    .eq('workspace_id', workspaceId)
    .eq('reconciled', false)
    .eq('amount_cents', movement.amount_cents)
    .not('invoice_id', 'is', null)
    .gte('paid_at', start.toISOString())
    .lte('paid_at', end.toISOString())
    .limit(20);
  if (pendingErr) throw new Error(pendingErr.message);
  const pendingCandidates = (pendingPayments || []).map((payment) => {
    const invoiceRaw = payment.billing_invoices as { pharmacies?: { trade_name?: string | null; legal_name?: string | null } | { trade_name?: string | null; legal_name?: string | null }[] | null } | { pharmacies?: { trade_name?: string | null; legal_name?: string | null } | { trade_name?: string | null; legal_name?: string | null }[] | null }[] | null;
    const invoice = Array.isArray(invoiceRaw) ? invoiceRaw[0] : invoiceRaw;
    const pharmacyRaw = invoice?.pharmacies;
    const pharmacy = Array.isArray(pharmacyRaw) ? pharmacyRaw[0] : pharmacyRaw;
    const dateScore = Math.max(0, 20 - daysBetween(movement.movement_date, String(payment.paid_at).slice(0, 10)) * 5);
    const descriptionScore = Math.max(textScore(movement.description, pharmacy?.trade_name), textScore(movement.description, pharmacy?.legal_name));
    return { payment, score: 60 + dateScore + descriptionScore };
  }).sort((a, b) => b.score - a.score);

  if (pendingCandidates.length === 1 && pendingCandidates[0].score >= 80) {
    await reconcileBankMovement(workspaceId, movement.id, String(pendingCandidates[0].payment.id));
    return {
      status: 'auto_reconciled' as const,
      invoice_id: String(pendingCandidates[0].payment.invoice_id),
      payment_id: String(pendingCandidates[0].payment.id),
      score: pendingCandidates[0].score,
    };
  }
  if (pendingCandidates.length) {
    await notifyBankMovement(workspaceId, {
      movementId: movement.id,
      paymentId: String(pendingCandidates[0].payment.id),
      invoiceId: String(pendingCandidates[0].payment.invoice_id),
      code: 'BANK_MATCH_REVIEW_REQUIRED',
      title: 'Recebimento bancário precisa de revisão',
      message: `Crédito de ${movement.amount_cents / 100} possui baixa pendente candidata, mas requer confirmação do operador.`,
      metadata: { candidate_count: pendingCandidates.length, match_confidence: pendingCandidates[0].score },
    });
    return { status: 'review_required' as const, invoice_id: String(pendingCandidates[0].payment.invoice_id), score: pendingCandidates[0].score };
  }

  const { data, error } = await supabase
    .from('billing_invoices')
    .select('id, billing_cycle_id, pharmacy_id, due_date, total_cents, amount_paid_cents, entity_type, pharmacies(id, trade_name, legal_name)')
    .eq('workspace_id', workspaceId)
    .neq('status', 'paid')
    .limit(200);
  if (error) throw new Error(error.message);
  const candidates = (data || [])
    .map((invoice) => {
      const balance = Number(invoice.total_cents || 0) - Number(invoice.amount_paid_cents || 0);
      if (balance !== movement.amount_cents) return null;
      const pharmacyRaw = invoice.pharmacies as { trade_name?: string | null; legal_name?: string | null } | { trade_name?: string | null; legal_name?: string | null }[] | null;
      const pharmacy = Array.isArray(pharmacyRaw) ? pharmacyRaw[0] : pharmacyRaw;
      const dateScore = invoice.due_date ? Math.max(0, 15 - daysBetween(movement.movement_date, String(invoice.due_date)) * 3) : 0;
      const descriptionScore = Math.max(textScore(movement.description, pharmacy?.trade_name), textScore(movement.description, pharmacy?.legal_name));
      return { invoice, balance, score: 60 + dateScore + descriptionScore };
    })
    .filter((v): v is NonNullable<typeof v> => Boolean(v))
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 1 && candidates[0].score >= 90) {
    const invoice = candidates[0].invoice;
    const now = new Date().toISOString();
    const newPaid = Number(invoice.amount_paid_cents || 0) + movement.amount_cents;
    const { data: payment, error: paymentErr } = await supabase
      .from('billing_payments')
      .insert({
        workspace_id: workspaceId,
        invoice_id: invoice.id,
        amount_cents: movement.amount_cents,
        paid_at: `${movement.movement_date}T12:00:00.000Z`,
        payment_method: 'transfer',
        bank_account_id: movement.bank_account_id,
        notes: `Conciliação automática por extrato bancário (${movement.description || 'sem descrição'})`,
        reconciled: true,
        reconciled_at: now,
        reconciled_by: null,
      })
      .select('id')
      .single();
    if (paymentErr) throw new Error(paymentErr.message);
    const { error: invErr } = await supabase
      .from('billing_invoices')
      .update({ amount_paid_cents: newPaid, status: newPaid >= Number(invoice.total_cents || 0) ? 'paid' : 'approved', updated_at: now })
      .eq('workspace_id', workspaceId)
      .eq('id', invoice.id);
    if (invErr) throw new Error(invErr.message);
    const { error: movErr } = await supabase
      .from('billing_bank_movements')
      .update({
        reconciled: true,
        billing_payment_id: payment.id,
        reconciled_at: now,
        reconciled_by: null,
        updated_at: now,
      })
      .eq('workspace_id', workspaceId)
      .eq('id', movement.id);
    if (movErr) throw new Error(movErr.message);
    if (newPaid >= Number(invoice.total_cents || 0) && invoice.billing_cycle_id) {
      try {
        await generateDriverPayablesFromCycle(workspaceId, String(invoice.billing_cycle_id));
      } catch (err) {
        await addBillingAuditNotification({
          workspaceId,
          severity: 'warning',
          code: 'DRIVER_PAYABLE_GENERATION_FAILED',
          title: 'APs dos entregadores não foram gerados',
          message:
            err instanceof Error
              ? `Fatura conciliada, mas os pagamentos dos entregadores não foram gerados: ${err.message}`
              : 'Fatura conciliada, mas os pagamentos dos entregadores não foram gerados.',
          metadata: { invoice_id: invoice.id, movement_id: movement.id, target_route: '/billing/receber' },
        });
      }
    }
    return { status: 'auto_reconciled' as const, invoice_id: String(invoice.id), payment_id: String(payment.id), score: candidates[0].score };
  }
  if (candidates.length) {
    await notifyBankMovement(workspaceId, {
      movementId: movement.id,
      invoiceId: String(candidates[0].invoice.id),
      code: 'BANK_MATCH_REVIEW_REQUIRED',
      title: 'Recebimento bancário precisa de revisão',
      message: `Crédito de ${movement.amount_cents / 100} possui fatura candidata, mas requer confirmação do operador.`,
      metadata: { candidate_count: candidates.length, match_confidence: candidates[0].score },
    });
    return { status: 'review_required' as const, invoice_id: String(candidates[0].invoice.id), score: candidates[0].score };
  }
  await notifyBankMovement(workspaceId, {
    movementId: movement.id,
    code: 'BANK_MOVEMENT_UNRECONCILED',
    title: 'Crédito bancário sem fatura conciliada',
    message: `Crédito de ${movement.amount_cents / 100} em ${movement.movement_date} não encontrou título em A receber.`,
  });
  return { status: 'unmatched' as const };
}

export async function autoReconcileImportedMovements(
  workspaceId: string,
  movementIds: string[]
): Promise<{ auto_reconciled: number; review_required: number; unmatched: number; payment_without_movement: number }> {
  if (!movementIds.length) return { auto_reconciled: 0, review_required: 0, unmatched: 0, payment_without_movement: 0 };

  const movements: Array<{
    id: string;
    bank_account_id: string;
    movement_date: string;
    amount_cents: number;
    direction: string;
    description: string | null;
  }> = [];
  for (const idChunk of chunkArray(movementIds, BANK_EXISTING_LOOKUP_CHUNK)) {
    const { data, error } = await supabase
      .from('billing_bank_movements')
      .select('id, bank_account_id, movement_date, amount_cents, direction, description')
      .eq('workspace_id', workspaceId)
      .in('id', idChunk)
      .eq('reconciled', false);
    if (error) throw new Error(error.message);
    movements.push(...((data || []) as typeof movements));
  }

  let auto_reconciled = 0;
  let review_required = 0;
  let unmatched = 0;
  const dates = movements.map((m) => String(m.movement_date).slice(0, 10)).sort();
  for (const movement of movements) {
    const result = movement.direction === 'debit'
      ? await autoReconcileDebitMovement(workspaceId, movement)
      : await autoReconcileCreditMovement(workspaceId, movement);
    if (result.status === 'auto_reconciled') auto_reconciled += 1;
    else if (result.status === 'review_required') review_required += 1;
    else unmatched += 1;
  }
  let payment_without_movement = 0;
  if (dates.length) {
    const { data: payments, error: paymentErr } = await supabase
      .from('billing_payments')
      .select('id, amount_cents, paid_at, payable_id, invoice_id')
      .eq('workspace_id', workspaceId)
      .eq('reconciled', false)
      .gte('paid_at', `${dates[0]}T00:00:00.000Z`)
      .lte('paid_at', `${dates[dates.length - 1]}T23:59:59.999Z`)
      .limit(100);
    if (paymentErr) throw new Error(paymentErr.message);
    for (const payment of payments || []) {
      await notifyPaymentWithoutMovement(workspaceId, payment);
      payment_without_movement += 1;
    }
  }
  return { auto_reconciled, review_required, unmatched, payment_without_movement };
}

/** Cap synchronous auto-reconcile so large statement imports stay under Cloud Run request limits. */
export function takeMovementsForAutoReconcile(movementIds: string[]): {
  to_reconcile: string[];
  pending: number;
} {
  const to_reconcile = movementIds.slice(0, BANK_AUTO_RECONCILE_MAX);
  return { to_reconcile, pending: Math.max(0, movementIds.length - to_reconcile.length) };
}

export async function reconcileBankMovement(
  workspaceId: string,
  movementId: string,
  paymentId: string,
  reconciledBy?: string | null
): Promise<void> {
  const { data, error } = await supabase.rpc('billing_reconcile_payment', {
    p_workspace_id: workspaceId,
    p_movement_id: movementId,
    p_payment_id: paymentId,
    p_reconciled_by: reconciledBy || null,
  });
  if (error) throw new Error(error.message);

  const result = data as {
    invoice?: { id?: string; status?: string; billing_cycle_id?: string | null } | null;
    movement?: { id?: string } | null;
    payment?: { invoice_id?: string | null } | null;
  };

  if (result.invoice?.status === 'paid' && result.invoice.billing_cycle_id) {
    try {
      await generateDriverPayablesFromCycle(workspaceId, String(result.invoice.billing_cycle_id));
    } catch (err) {
      await addBillingAuditNotification({
        workspaceId,
        severity: 'warning',
        code: 'DRIVER_PAYABLE_GENERATION_FAILED',
        title: 'APs dos entregadores não foram gerados',
        message:
          err instanceof Error
            ? `Fatura conciliada, mas os pagamentos dos entregadores não foram gerados: ${err.message}`
            : 'Fatura conciliada, mas os pagamentos dos entregadores não foram gerados.',
        metadata: { invoice_id: result.payment?.invoice_id, movement_id: result.movement?.id, target_route: '/billing/receber' },
      });
    }
  }
}

export async function getTreasurySummary(workspaceId: string, bankAccountId?: string) {
  let movQ = supabase
    .from('billing_bank_movements')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('reconciled', false);
  if (bankAccountId) movQ = movQ.eq('bank_account_id', bankAccountId);
  const { count: unreconciledMovements } = await movQ;

  let payQ = supabase
    .from('billing_payments')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('reconciled', false);
  const { count: unreconciledPayments } = await payQ;

  return {
    unreconciled_movements: unreconciledMovements || 0,
    unreconciled_payments: unreconciledPayments || 0,
  };
}
