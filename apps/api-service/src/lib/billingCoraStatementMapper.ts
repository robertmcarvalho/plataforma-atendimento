/**
 * Mapper Cora bank-statement JSON → BankMovementImportRow + janela de sync.
 * Sem HTTP — puro para testes unitários.
 */

import type { BankMovementImportRow } from './billingTreasuryEngine';

export type CoraStatementEntry = {
  id?: string;
  type?: string;
  amount?: number;
  createdAt?: string;
  transaction?: {
    id?: string;
    type?: string;
    description?: string;
  } | null;
  counterParty?: {
    name?: string;
    identity?: string;
  } | null;
};

export type CoraStatementBalancePoint = {
  date?: string;
  balance?: number;
};

export type CoraStatementPage = {
  entries?: CoraStatementEntry[];
  start?: CoraStatementBalancePoint;
  end?: CoraStatementBalancePoint;
  aggregations?: unknown;
  page?: number;
  totalPages?: number;
  totalItems?: number;
};

const BRT = 'America/Sao_Paulo';

/** Converte instant ISO (ou date) para YYYY-MM-DD em America/Sao_Paulo. */
export function coraCreatedAtToMovementDate(
  createdAt: string | null | undefined,
  timeZone = BRT
): string | null {
  const raw = String(createdAt || '').trim();
  if (!raw) return null;
  const dateOnly = raw.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateOnly) return dateOnly[1];
  // Cora envia offsets curtos (`+00`, `-03`) que o Date do JS rejeita — normaliza para ±HH:MM.
  const normalized = raw.replace(/([+-]\d{2})(?!:?\d{2})$/, '$1:00');
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  // en-CA → YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function mapCoraEntryDirection(type: string | null | undefined): 'credit' | 'debit' | null {
  const t = String(type || '')
    .trim()
    .toUpperCase();
  if (t === 'CREDIT' || t === 'UNBLOCK') return 'credit';
  if (t === 'DEBIT' || t === 'BLOCK') return 'debit';
  return null;
}

export function buildCoraEntryExternalId(entry: CoraStatementEntry): string | null {
  const txId = String(entry.transaction?.id || '').trim();
  if (txId) return `cora:${txId}`;
  const entryId = String(entry.id || '').trim();
  if (entryId) return `cora:${entryId}`;
  return null;
}

export function buildCoraEntryDescription(entry: CoraStatementEntry): string | null {
  const txDesc = String(entry.transaction?.description || '').trim();
  const counter = String(
    entry.counterParty?.name ||
      (entry.transaction as { counterParty?: { name?: string } } | null | undefined)?.counterParty
        ?.name ||
      ''
  ).trim();
  const identity = String(
    entry.counterParty?.identity ||
      (entry.transaction as { counterParty?: { identity?: string } } | null | undefined)?.counterParty
        ?.identity ||
      ''
  ).trim();
  const idPart = buildCoraEntryExternalId(entry)?.replace(/^cora:/, '') || '';
  const parts = [txDesc || null, counter || null, identity || null, idPart || null].filter(Boolean);
  // Espelha espírito CSV: "transacao — identificacao"
  if (txDesc && idPart) return `${txDesc} — ${idPart}`;
  if (txDesc && counter) return `${txDesc} — ${counter}`;
  if (parts.length) return parts.slice(0, 2).join(' — ');
  return null;
}

export function mapCoraStatementEntriesToImportRows(
  entries: CoraStatementEntry[] | null | undefined
): BankMovementImportRow[] {
  const rows: BankMovementImportRow[] = [];
  for (const entry of entries || []) {
    const movement_date = coraCreatedAtToMovementDate(entry.createdAt);
    const amount_cents = Math.round(Number(entry.amount));
    const direction = mapCoraEntryDirection(entry.type);
    const external_id = buildCoraEntryExternalId(entry);
    if (!movement_date || !Number.isFinite(amount_cents) || amount_cents <= 0 || !direction) {
      continue;
    }
    rows.push({
      movement_date,
      amount_cents,
      direction,
      description: buildCoraEntryDescription(entry),
      external_id,
    });
  }
  return rows;
}

/** Civil date YYYY-MM-DD in America/Sao_Paulo for "now". */
export function civilDateInTimeZone(now: Date = new Date(), timeZone = BRT): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addCivilDays(isoDate: string, deltaDays: number): string {
  const m = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Data civil inválida: ${isoDate}`);
  // Noon UTC avoids DST edge when shifting calendar days.
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Janela MVP: últimos 3 dias corridos (end = hoje BRT; start = end-2),
 * com piso last_successful_end_date - 1 (não “pula” dias se cursor atrasado).
 *
 * start = max(end - 2, last_end - 1) quando last_end existe;
 * se last_end for muito antigo, start = last_end - 1 (cobre backlog sem furar).
 */
export function resolveCoraStatementSyncWindow(params: {
  today?: string;
  lastSuccessfulEndDate?: string | null;
  overlapDays?: number;
}): { start: string; end: string } {
  const overlap = params.overlapDays ?? 3;
  const end = params.today || civilDateInTimeZone();
  const overlapStart = addCivilDays(end, -(overlap - 1));
  const last = params.lastSuccessfulEndDate ? String(params.lastSuccessfulEndDate).slice(0, 10) : null;
  if (!last || !/^\d{4}-\d{2}-\d{2}$/.test(last)) {
    return { start: overlapStart, end };
  }
  const floorStart = addCivilDays(last, -1);
  // Se o cursor está recente, usa overlap curto; se atrasado, começa em floorStart.
  const start = floorStart < overlapStart ? floorStart : overlapStart;
  if (start > end) return { start: end, end };
  return { start, end };
}
