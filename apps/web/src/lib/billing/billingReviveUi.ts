import { cn } from '@/lib/utils';

/* ── Tipografia ───────────────────────────────────────────── */

export const billingFilterLabelClassName = 'text-[10px] uppercase tracking-wide text-subtle-foreground';

export const billingTableHeadClassName =
  'border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground';

export const billingTableCellClassName = 'px-4 py-2.5 text-sm';

export const billingMonoCellClassName = 'font-mono text-[11px]';

/* ── Superfícies (Financeiro Revive) ─────────────────────── */

export const billingTableShellClassName = 'overflow-x-auto rounded-lg border border-border bg-surface';
export const billingTableClassName = 'min-w-[760px] w-full text-sm';

export const billingSubNavClassName =
  'mb-6 flex flex-nowrap gap-0.5 overflow-x-auto rounded-lg border border-border bg-surface p-1 scrollbar-thin';

export const billingKpiCompactClassName = 'rounded-lg border border-border bg-surface px-3 py-2';

export const billingKpiDetailClassName = 'rounded-lg border border-border bg-surface p-4';

export const billingKpiHeroClassName = 'rounded-lg border border-border bg-surface p-5 shadow-sm';

export const billingKpiValueClassName = 'text-lg font-semibold tracking-tight';

export const billingKpiHeroValueClassName = 'mt-2 font-mono text-2xl font-semibold tabular-nums';

export const billingKpiLabelClassName = 'text-[10px] uppercase tracking-wide text-subtle-foreground';

export const billingKpiHeroLabelClassName =
  'text-xs font-semibold uppercase tracking-wider text-subtle-foreground';

/* ── Status fatura (Revive Faturamento.tsx) ──────────────── */

/**
 * API → label Revive (StatusFatura):
 * | API / derivado          | Revive key | Label      |
 * |-------------------------|------------|------------|
 * | draft, approved         | aberta     | Em aberto  |
 * | sent                    | enviada    | Enviada    |
 * | paid                    | paga       | Paga       |
 * | overdue (due_date pass.)| vencida    | Vencida    |
 *
 * draft/approved não existem no protótipo; ambos usam aberta/Em aberto.
 */
export const INVOICE_REVIVE_LABEL: Record<string, string> = {
  draft: 'Em aberto',
  approved: 'Em aberto',
  sent: 'Enviada',
  paid: 'Paga',
  overdue: 'Vencida',
};

export const INVOICE_REVIVE_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Todos os status' },
  { value: 'draft', label: 'Em aberto' },
  { value: 'approved', label: 'Em aberto' },
  { value: 'sent', label: 'Enviada' },
  { value: 'paid', label: 'Paga' },
];

export function billingTodayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function billingInvoiceIsOverdue(
  status: string,
  dueDate?: string | null,
  today = billingTodayIso()
) {
  return Boolean(dueDate && status !== 'paid' && dueDate < today);
}

export function invoiceReviveDisplayStatus(
  status: string,
  dueDate?: string | null
): { key: string; label: string } {
  if (billingInvoiceIsOverdue(status, dueDate)) {
    return { key: 'overdue', label: INVOICE_REVIVE_LABEL.overdue };
  }
  return {
    key: status,
    label: INVOICE_REVIVE_LABEL[status] || status,
  };
}

/** NFS-e: API → Revive (StatusNfse) */
export const NFSE_REVIVE_LABEL: Record<string, string> = {
  pending: 'Pendente',
  authorized: 'Emitida',
  rejected: 'Com erro',
  canceled: 'Cancelada',
};

export function nfseReviveLabel(status?: string | null) {
  if (!status) return NFSE_REVIVE_LABEL.pending;
  return NFSE_REVIVE_LABEL[status] || status;
}

/**
 * Boleto: API → Revive (StatusBoleto).
 * open + vencimento passado → vencido/Vencido (derivado, igual protótipo).
 * error não existe no protótipo → Com erro (mesmo label de NFS-e erro).
 */
export const BOLETO_REVIVE_LABEL: Record<string, string> = {
  pending: 'Pendente',
  open: 'Gerado',
  paid: 'Pago',
  canceled: 'Cancelado',
  error: 'Com erro',
  vencido: 'Vencido',
};

export function boletoReviveLabel(
  status?: string | null,
  dueDate?: string | null,
  invoiceStatus?: string
) {
  if (!status) return BOLETO_REVIVE_LABEL.pending;
  if (
    status === 'open' &&
    invoiceStatus !== 'paid' &&
    dueDate &&
    dueDate < billingTodayIso()
  ) {
    return BOLETO_REVIVE_LABEL.vencido;
  }
  return BOLETO_REVIVE_LABEL[status] || status;
}

export function boletoReviveUiKey(
  status?: string | null,
  dueDate?: string | null,
  invoiceStatus?: string
) {
  if (
    status === 'open' &&
    invoiceStatus !== 'paid' &&
    dueDate &&
    dueDate < billingTodayIso()
  ) {
    return 'vencido';
  }
  return status || 'pending';
}

export const INVOICE_STATUS_UI: Record<string, string> = {
  draft: 'border-warning/25 bg-warning/10 text-warning',
  approved: 'border-warning/25 bg-warning/10 text-warning',
  sent: 'border-primary/25 bg-primary/10 text-primary',
  paid: 'border-success/25 bg-success/10 text-success',
  overdue: 'border-destructive/25 bg-destructive/10 text-destructive',
};

export function invoiceStatusUiClass(status: string) {
  return cn(
    'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium',
    INVOICE_STATUS_UI[status] || INVOICE_STATUS_UI.draft
  );
}

export const DOCUMENT_STATUS_UI: Record<string, string> = {
  pending: 'border-border bg-muted/40 text-muted-foreground',
  authorized: 'border-success/25 bg-success/10 text-success',
  emitida: 'border-success/25 bg-success/10 text-success',
  rejected: 'border-destructive/25 bg-destructive/10 text-destructive',
  erro: 'border-destructive/25 bg-destructive/10 text-destructive',
  canceled: 'border-border bg-muted/40 text-subtle-foreground',
  cancelada: 'border-border bg-muted/40 text-subtle-foreground',
  open: 'border-primary/25 bg-primary/10 text-primary',
  gerado: 'border-primary/25 bg-primary/10 text-primary',
  paid: 'border-success/25 bg-success/10 text-success',
  pago: 'border-success/25 bg-success/10 text-success',
  error: 'border-destructive/25 bg-destructive/10 text-destructive',
  vencido: 'border-destructive/25 bg-destructive/10 text-destructive',
  canceled_slip: 'border-border bg-muted/40 text-subtle-foreground',
};

export function documentStatusUiClass(status: string) {
  return cn(
    'inline-flex rounded-md border px-2 py-1 text-[11px] font-medium',
    DOCUMENT_STATUS_UI[status] || DOCUMENT_STATUS_UI.pending
  );
}

/* ── Segment control ─────────────────────────────────────── */

export const billingSegmentShellClassName = 'flex gap-1 rounded-md border border-border bg-surface p-0.5';

export function billingSegmentButton(active: boolean) {
  return cn(
    'rounded px-2.5 py-1 text-[11px] font-medium capitalize transition-colors',
    active ? 'bg-surface-elevated text-foreground' : 'text-muted-foreground hover:text-foreground'
  );
}

/* ── Tabs shadcn no padrão Financeiro ────────────────────── */

export const billingTabsListClassName = 'mb-4 h-auto w-full flex-wrap justify-start rounded-lg border border-border bg-surface p-1';

export const billingTabsTriggerClassName =
  'flex-none rounded-md px-3 py-1.5 text-xs font-medium data-active:bg-primary data-active:text-primary-foreground data-active:shadow-sm';

/* ── Tags / badges (Revive Entregas + Acertos) ─────────── */

export const billingTagClassName =
  'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ring-1';

export function entityBadgeClass(entity: 'coop' | 'flux') {
  return cn(
    billingTagClassName,
    entity === 'coop'
      ? 'bg-success/15 text-success ring-success/20'
      : 'bg-channel-instagram/15 text-channel-instagram ring-channel-instagram/20'
  );
}

export type DeliverySourceKey = 'flux_api' | 'flux_db' | 'manual' | 'csv' | 'external_app';

export const DELIVERY_SOURCE_LABEL: Record<DeliverySourceKey, string> = {
  flux_api: 'Importação Flux',
  flux_db: 'Banco Flux',
  manual: 'Lançamento manual',
  csv: 'Planilha CSV',
  external_app: 'Planilha Excel',
};

export const DELIVERY_SOURCE_TONE: Record<DeliverySourceKey, string> = {
  flux_api: 'bg-success/15 text-success ring-success/20',
  flux_db: 'bg-primary/15 text-primary ring-primary/20',
  manual: 'bg-warning/15 text-warning ring-warning/20',
  csv: 'bg-channel-instagram/15 text-channel-instagram ring-channel-instagram/20',
  external_app: 'bg-channel-instagram/15 text-channel-instagram ring-channel-instagram/20',
};

export function uiDeliverySourceKey(source: string): DeliverySourceKey {
  if (source in DELIVERY_SOURCE_LABEL) return source as DeliverySourceKey;
  return 'csv';
}

export function deliverySourceBadge(source: string) {
  const key = uiDeliverySourceKey(source);
  return {
    label: DELIVERY_SOURCE_LABEL[key],
    className: cn(billingTagClassName, DELIVERY_SOURCE_TONE[key]),
  };
}

export function contagemPorOrigem(
  rows: { source: string; cancelled: boolean; verified: boolean }[]
): Partial<Record<DeliverySourceKey, number>> {
  const out: Partial<Record<DeliverySourceKey, number>> = {};
  for (const r of rows) {
    if (r.cancelled || !r.verified) continue;
    const k = uiDeliverySourceKey(r.source);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/* ── Status acerto (Revive Acertos.tsx) ──────────────────── */

export const SETTLEMENT_STATUS_UI: Record<string, string> = {
  open: 'bg-muted text-muted-foreground',
  in_review: 'bg-warning/15 text-warning',
  approved: 'bg-success/15 text-success',
  paid: 'bg-primary/15 text-primary',
};

export function settlementStatusUiClass(status: string) {
  return cn(
    'rounded px-1.5 py-0.5 text-[10px] font-medium',
    SETTLEMENT_STATUS_UI[status] || SETTLEMENT_STATUS_UI.open
  );
}

/* ── A pagar ─────────────────────────────────────────────── */

export function payableDisplayStatus(
  status: string,
  amountCents: number,
  amountPaidCents: number,
  dueDate?: string | null
) {
  const balance = amountCents - amountPaidCents;
  const today = new Date().toISOString().slice(0, 10);
  if (status === 'paid' || balance <= 0) return { label: 'Paga', className: 'text-success capitalize' };
  if (status === 'cancelled') return { label: 'Cancelada', className: 'text-destructive capitalize' };
  if (dueDate && dueDate < today) return { label: 'Vencida', className: 'text-destructive capitalize' };
  if (amountPaidCents > 0 && balance > 0) return { label: 'Parcial', className: 'text-warning capitalize' };
  if (status === 'draft') return { label: 'Rascunho', className: 'text-muted-foreground capitalize' };
  return { label: 'Aberta', className: 'text-muted-foreground capitalize' };
}

export function billingSeverityBadge(severity: string) {
  const s = String(severity || '').toLowerCase();
  if (s === 'critical') {
    return cn(billingTagClassName, 'bg-destructive/15 text-destructive ring-destructive/25');
  }
  if (s === 'warning') {
    return cn(billingTagClassName, 'bg-warning/15 text-warning ring-warning/25');
  }
  return cn(billingTagClassName, 'bg-primary/15 text-primary ring-primary/25');
}

export function billingCountBadge(tone: 'warning' | 'primary' | 'muted' = 'warning') {
  if (tone === 'primary') return 'rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-medium text-primary';
  if (tone === 'muted') return 'rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground';
  return 'rounded-full bg-warning/15 px-2.5 py-1 text-[11px] font-medium text-warning';
}

export function billingNoticeClassName(tone: 'warning' | 'info' = 'warning') {
  if (tone === 'info') return 'rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground';
  return 'rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning';
}
