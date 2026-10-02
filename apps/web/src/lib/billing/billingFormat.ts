import { settlementStatusUiClass } from '@/lib/billing/billingReviveUi';

export function formatBrlCents(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function fmtDate(iso: string): string {
  const s = String(iso || '').slice(0, 10);
  if (!s) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

export const SETTLEMENT_STATUS_LABELS: Record<string, string> = {
  open: 'Aberto',
  in_review: 'Em revisão',
  approved: 'Aprovado',
  paid: 'Pago',
};

export const CYCLE_STATUS_LABELS: Record<string, string> = {
  open: 'Aberto',
  closed: 'Fechado',
};

export function settlementStatusBadge(status: string) {
  const label = SETTLEMENT_STATUS_LABELS[status] || status;
  return { label, className: settlementStatusUiClass(status) };
}

export const DELIVERY_SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual',
  csv: 'CSV',
  flux_api: 'Flux API',
  flux_db: 'Flux DB',
  external_app: 'App externo',
};
