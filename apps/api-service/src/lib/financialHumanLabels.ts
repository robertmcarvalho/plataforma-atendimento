import { FinancialEntryStatus } from '@plataforma/operational-notes';

/** Rótulos em português para gestores/atendentes (sem slugs de banco). */

const ENTRY_TYPE_LABELS: Record<string, string> = {
  advance: 'Adiantamento',
  absence: 'Falta',
  uniform: 'Uniforme',
  bag: 'Bag',
  quota: 'Cota',
  digital_cert: 'Certificado digital',
  other: 'Outros',
  daily: 'Diária',
  fine: 'Multa',
  adjustment: 'Ajuste',
};

const ENTRY_STATUS_LABELS: Record<string, string> = {
  [FinancialEntryStatus.ACTIVE]: 'em aberto',
  [FinancialEntryStatus.PENDING_APPROVAL]: 'aguardando aprovação',
  [FinancialEntryStatus.APPROVED]: 'aprovado (pendente de lançamento)',
  [FinancialEntryStatus.CANCELLED]: 'cancelado',
  [FinancialEntryStatus.REJECTED]: 'reprovado',
  [FinancialEntryStatus.INFORMED]: 'informado',
  [FinancialEntryStatus.SETTLED]: 'quitado',
  [FinancialEntryStatus.DRAFT]: 'rascunho',
  paid: 'quitado',
  pending: 'pendente',
  done: 'concluído',
};

export function formatFinancialEntryTypeLabel(type: string): string {
  const key = String(type || '').trim().toLowerCase();
  return ENTRY_TYPE_LABELS[key] || (key ? key.replace(/_/g, ' ') : 'Lançamento');
}

export function formatFinancialEntryStatusLabel(status: string): string {
  const key = String(status || '').trim().toLowerCase();
  return ENTRY_STATUS_LABELS[key] || (key ? key.replace(/_/g, ' ') : '—');
}

export function formatFinancialDateBr(isoDate: string): string {
  const raw = String(isoDate || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return raw || '—';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function formatOriginLabel(origin: string | null | undefined): string {
  const o = String(origin || '').trim().toLowerCase();
  if (o === 'portal_lider' || o === 'portal-lider') return 'Portal do líder';
  if (o === 'whatsapp') return 'WhatsApp';
  if (o === 'inbox') return 'Inbox';
  return origin?.trim() || 'Portal do líder';
}
