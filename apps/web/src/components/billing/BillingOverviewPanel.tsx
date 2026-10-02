'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Banknote, Clock, DollarSign, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  type BillingAuditNotification,
  fetchBillingAuditNotifications,
  fetchBillingInvoices,
  fetchBillingOffboardingPreviews,
  fetchBillingPayables,
  fetchTreasurySummary,
  generateOffboardingPayable,
  resolveBillingAuditNotification,
} from '@/lib/billing/billingApi';
import { formatBrlCents, fmtDate } from '@/lib/billing/billingFormat';
import { billingKpiDetailClassName, billingKpiLabelClassName, billingKpiValueClassName, billingCountBadge, billingSeverityBadge, billingNoticeClassName } from '@/lib/billing/billingReviveUi';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { useClientPagination } from '@/lib/billing/billingListUtils';
import { pharmacyDisplayName } from '@/lib/billing/billingDisplay';
import { humanizeOffboardingWarning } from '@/lib/billing/billingOperationalLabels';
import { cn } from '@/lib/utils';

function appendParam(params: URLSearchParams, key: string, value: string | null | undefined) {
  if (value) params.set(key, value);
}

function auditNotificationHref(notification: BillingAuditNotification): string {
  const metadata = notification.metadata || {};

  if (notification.code.includes('OFFBOARDING') || notification.code === 'DRIVER_OFFBOARDING_PREVIEW_WARNINGS') {
    const previewId = typeof metadata.preview_id === 'string' ? metadata.preview_id : null;
    if (previewId) return `/billing/desligamento/${previewId}`;
    return '/billing';
  }

  const params = new URLSearchParams();
  appendParam(params, 'notification_id', notification.id);
  appendParam(params, 'cycle_id', notification.billing_cycle_id);
  appendParam(params, 'pharmacy_id', notification.pharmacy_id);
  appendParam(params, 'driver_id', notification.driver_id);

  const maybePayableId = typeof metadata.payable_id === 'string' ? metadata.payable_id : null;
  const maybePaymentId = typeof metadata.payment_id === 'string' ? metadata.payment_id : null;
  const maybeMovementId = typeof metadata.bank_movement_id === 'string' ? metadata.bank_movement_id : null;
  const maybeFinancialEntryId = typeof metadata.financial_entry_id === 'string' ? metadata.financial_entry_id : null;

  if (notification.code === 'C6_BLOCKED_INVOICE_NOT_PAID' || maybePayableId) {
    appendParam(params, 'payable_id', maybePayableId);
    return `/billing/pagar?${params.toString()}`;
  }
  if (maybePaymentId || maybeMovementId || notification.code.includes('RECONCILIATION')) {
    appendParam(params, 'payment_id', maybePaymentId);
    appendParam(params, 'movement_id', maybeMovementId);
    return `/billing/conciliacao?${params.toString()}`;
  }
  if (maybeFinancialEntryId || notification.code.startsWith('DAILY_') || notification.code.includes('MG')) {
    appendParam(params, 'financial_entry_id', maybeFinancialEntryId);
    return `/billing/acertos?${params.toString()}`;
  }
  if (notification.code.includes('DELIVERY') || notification.code.includes('PHARMACY')) {
    return `/billing/entregas?${params.toString()}`;
  }
  return `/billing/acertos?${params.toString()}`;
}

export function BillingOverviewPanel() {
  const qc = useQueryClient();
  const payablesQuery = useQuery({
    queryKey: ['billing', 'overview', 'payables'],
    queryFn: () => fetchBillingPayables(),
  });
  const invoicesQuery = useQuery({
    queryKey: ['billing', 'overview', 'invoices'],
    queryFn: () => fetchBillingInvoices(),
  });
  const treasuryQuery = useQuery({
    queryKey: ['billing', 'overview', 'treasury'],
    queryFn: () => fetchTreasurySummary(),
  });
  const auditQuery = useQuery({
    queryKey: ['billing', 'audit-notifications', 'open'],
    queryFn: () => fetchBillingAuditNotifications({ status: 'open' }),
  });
  const offboardingQuery = useQuery({
    queryKey: ['billing', 'offboarding-previews', 'preview'],
    queryFn: () => fetchBillingOffboardingPreviews({ status: 'preview' }),
  });
  const resolveAuditMut = useMutation({
    mutationFn: (id: string) => resolveBillingAuditNotification(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing', 'audit-notifications'] }),
  });
  const generateOffboardingPayableMut = useMutation({
    mutationFn: (id: string) => generateOffboardingPayable(id),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['billing', 'offboarding-previews'] }),
        qc.invalidateQueries({ queryKey: ['billing', 'overview', 'payables'] }),
      ]);
    },
  });

  const payables = useMemo(() => payablesQuery.data || [], [payablesQuery.data]);
  const invoices = useMemo(() => invoicesQuery.data || [], [invoicesQuery.data]);
  const auditNotifications = auditQuery.data || [];
  const auditPagination = useClientPagination(auditNotifications);
  const offboardingPreviews = offboardingQuery.data || [];
  const offboardingPagination = useClientPagination(offboardingPreviews);

  const metrics = useMemo(() => {
    const openPayable = (p: (typeof payables)[number]) => p.status !== 'paid' && p.status !== 'cancelled';
    const openInvoice = (i: (typeof invoices)[number]) => i.status !== 'paid';

    const aReceber = invoices.filter(openInvoice).reduce((s, i) => s + Math.max(0, i.total_cents - i.amount_paid_cents), 0);
    const aPagar = payables.filter(openPayable).reduce((s, p) => s + Math.max(0, p.amount_cents - p.amount_paid_cents), 0);
    const today = new Date().toISOString().slice(0, 10);
    const vencidas = payables
      .filter((p) => openPayable(p) && p.due_date && p.due_date < today)
      .reduce((s, p) => s + Math.max(0, p.amount_cents - p.amount_paid_cents), 0);
    const baixasPend = (treasuryQuery.data?.unreconciled_payments || 0) + (treasuryQuery.data?.unreconciled_movements || 0);

    return { aReceber, aPagar, vencidas, baixasPend };
  }, [payables, invoices, treasuryQuery.data]);

  const cards = [
    { label: 'A receber', value: formatBrlCents(metrics.aReceber), icon: TrendingUp, tone: 'bg-success/15 text-success' },
    { label: 'A pagar', value: formatBrlCents(metrics.aPagar), icon: DollarSign, tone: 'bg-primary/15 text-primary' },
    { label: 'Em atraso', value: formatBrlCents(metrics.vencidas), icon: AlertCircle, tone: 'bg-destructive/15 text-destructive' },
    { label: 'Baixas p/ conciliar', value: String(metrics.baixasPend), icon: Banknote, tone: 'bg-warning/15 text-warning' },
  ] as const;

  const pendingPayables = payables
    .filter((p) => p.status !== 'paid' && p.status !== 'cancelled')
    .sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')))
    .slice(0, 6);

  const pendingInvoices = invoices
    .filter((i) => i.status !== 'paid')
    .sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || '')))
    .slice(0, 6);

  return (
    <div>
      <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className={billingKpiDetailClassName}>
            <div className={`flex h-7 w-7 items-center justify-center rounded-md ${c.tone}`}>
              <c.icon className="h-3.5 w-3.5" />
            </div>
            <div className={`mt-3 ${billingKpiValueClassName}`}>{c.value}</div>
            <div className={billingKpiLabelClassName}>{c.label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className={billingKpiDetailClassName}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Próximos vencimentos — A pagar</h3>
            <Link href="/billing/pagar" className="text-xs text-primary hover:underline">
              Ver tudo
            </Link>
          </div>
          <ul className="space-y-2">
            {pendingPayables.map((p) => (
              <li key={p.id} className="flex items-center justify-between border-b border-border/40 pb-1.5 text-xs">
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.description || p.beneficiary_name || 'Conta a pagar'}</div>
                  <div className="text-muted-foreground">venc. {p.due_date ? fmtDate(p.due_date) : '—'}</div>
                </div>
                <span className="font-mono font-semibold">
                  {formatBrlCents(Math.max(0, p.amount_cents - p.amount_paid_cents))}
                </span>
              </li>
            ))}
            {!pendingPayables.length ? (
              <li className="text-xs text-muted-foreground">Nenhuma conta pendente.</li>
            ) : null}
          </ul>
        </div>

        <div className={billingKpiDetailClassName}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">A receber pendente</h3>
            <Link href="/billing/receber" className="text-xs text-primary hover:underline">
              Ver tudo
            </Link>
          </div>
          {pendingInvoices.length ? (
            <ul className="space-y-2">
              {pendingInvoices.map((i) => (
                <li key={i.id} className="flex items-center justify-between border-b border-border/40 pb-1.5 text-xs">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      Fatura {pharmacyDisplayName(i.pharmacies) || i.pharmacy_id.slice(0, 8)}
                    </div>
                    <div className="text-muted-foreground">
                      venc. {i.due_date ? fmtDate(i.due_date) : '—'} · {i.entity_type.toUpperCase()}
                    </div>
                  </div>
                  <span className="font-mono font-semibold">
                    {formatBrlCents(Math.max(0, i.total_cents - i.amount_paid_cents))}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-md border border-dashed border-border bg-background/40 p-6 text-center text-xs text-muted-foreground">
              <Clock className="mx-auto mb-2 h-5 w-5" />
              Aprove um acerto em{' '}
              <Link href="/billing/acertos" className="text-primary hover:underline">
                Acertos
              </Link>{' '}
              para gerar faturas.
            </div>
          )}
        </div>
      </div>

      <div className={`mt-3 ${billingKpiDetailClassName}`}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Auditoria do faturamento</h3>
            <p className="text-xs text-muted-foreground">Ocorrências geradas pelo motor de acertos, MG, diárias e pagamentos.</p>
          </div>
          <span className={billingCountBadge('warning')}>
            {auditQuery.data?.length || 0} aberta(s)
          </span>
        </div>

        {auditPagination.pageItems.length ? (
          <ul className="space-y-2">
            {auditPagination.pageItems.map((n) => {
              const href = auditNotificationHref(n);
              return (
                <li key={n.id} className="rounded-lg border border-border/70 bg-background/50 p-3 text-xs">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={billingSeverityBadge(n.severity)}>
                          {n.severity === 'critical' ? 'Crítico' : n.severity === 'warning' ? 'Atenção' : 'Info'}
                        </span>
                        <span className="font-semibold">{n.title}</span>
                      </div>
                      <p className="mt-1 text-muted-foreground">{n.message}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {n.billing_cycles?.label || 'Ciclo não informado'}
                        {n.pharmacies ? ` · ${pharmacyDisplayName(n.pharmacies)}` : ''}
                        {n.drivers?.name ? ` · ${n.drivers.name}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                      <Link
                        href={href}
                        className="inline-flex h-8 items-center rounded-md border border-primary/30 bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/15"
                      >
                        Abrir
                      </Link>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => resolveAuditMut.mutate(n.id)}
                        disabled={resolveAuditMut.isPending}
                      >
                        Resolver
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-md border border-dashed border-border bg-background/40 p-6 text-center text-xs text-muted-foreground">
            Nenhuma pendência de auditoria aberta.
          </div>
        )}
        {auditPagination.totalItems > auditPagination.pageSize ? (
          <PaginationControls
            page={auditPagination.page}
            pageSize={auditPagination.pageSize}
            totalItems={auditPagination.totalItems}
            onPageChange={auditPagination.setPage}
            itemLabel="ocorrências"
          />
        ) : null}
      </div>

      <div className={`mt-3 ${billingKpiDetailClassName}`}>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Acertos de desligamento</h3>
            <p className="text-xs text-muted-foreground">Prévias automáticas geradas ao aprovar desligamento de entregador.</p>
          </div>
          <span className={billingCountBadge('primary')}>
            {offboardingQuery.data?.length || 0} prévia(s)
          </span>
        </div>

        {offboardingPagination.pageItems.length ? (
          <ul className="space-y-2">
            {offboardingPagination.pageItems.map((preview) => {
              const driverName = preview.payload?.driver?.name || preview.drivers?.name || preview.driver_id.slice(0, 8);
              const warnings = preview.payload?.warnings || [];
              return (
                <li key={preview.id} className="rounded-lg border border-border/70 bg-background/50 p-3 text-xs">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{driverName}</div>
                      <div className="mt-1 text-muted-foreground">
                        Último dia {fmtDate(preview.last_worked_at)} · bruto {formatBrlCents(preview.gross_cents)} · descontos{' '}
                        {formatBrlCents(preview.discount_cents)}
                      </div>
                      <div className="mt-1 font-mono text-sm font-semibold">Líquido {formatBrlCents(preview.net_cents)}</div>
                      {warnings.length ? (
                        <div className={cn('mt-2 rounded-md px-2 py-1 text-[11px]', billingNoticeClassName('warning'))}>
                          {warnings.slice(0, 2).map((w) => humanizeOffboardingWarning(w)).join(' ')}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                      <Link
                        href={`/billing/desligamento/${preview.id}`}
                        className="inline-flex h-8 items-center rounded-md border border-primary/30 bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/15"
                      >
                        Abrir
                      </Link>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={generateOffboardingPayableMut.isPending || preview.net_cents <= 0}
                        onClick={() => generateOffboardingPayableMut.mutate(preview.id)}
                      >
                        Gerar AP
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-md border border-dashed border-border bg-background/40 p-6 text-center text-xs text-muted-foreground">
            Nenhuma prévia de desligamento aguardando AP.
          </div>
        )}
        {offboardingPagination.totalItems > offboardingPagination.pageSize ? (
          <PaginationControls
            page={offboardingPagination.page}
            pageSize={offboardingPagination.pageSize}
            totalItems={offboardingPagination.totalItems}
            onPageChange={offboardingPagination.setPage}
            itemLabel="prévias"
          />
        ) : null}
      </div>
    </div>
  );
}
