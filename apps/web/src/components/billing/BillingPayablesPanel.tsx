'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpFromLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  approveBillingPayable,
  fetchBillingCycles,
  fetchBillingPayables,
  generateCompanyPayroll,
  payBillingPayable,
  releaseBillingPayable,
  type BillingPayable,
} from '@/lib/billing/billingApi';
import { formatBrlCents, fmtDate } from '@/lib/billing/billingFormat';
import { readCycleParam, replaceQueryIfChanged, writeCycleParam } from '@/lib/billing/billingFilterUrl';
import { isDriverLinkedToPharmacy, type DriverPharmacyLinkLike } from '@/lib/billing/isDriverLinkedToPharmacy';
import {
  billingTableShellClassName,
  billingTabsListClassName,
  billingTabsTriggerClassName,
  payableDisplayStatus,
  billingNoticeClassName,
} from '@/lib/billing/billingReviveUi';
import { BillingBaixaDialog } from '@/components/billing/BillingBaixaDialog';
import { BillingPayslipDrawer } from '@/components/billing/BillingPayslipDrawer';
import { BillingCycleSelect } from '@/components/billing/BillingCycleSelect';
import { BillingCostCenterFilter } from '@/components/billing/BillingCostCenterFilter';
import { BillingDriverFilter } from '@/components/billing/BillingDriverFilter';
import { BillingEntityBadge } from '@/components/billing/BillingEntityBadge';
import { BillingPharmacyFilter } from '@/components/billing/BillingPharmacyFilter';
import { BillingSaldoCell } from '@/components/billing/BillingSaldoCell';
import { BillingStatusChips } from '@/components/billing/BillingStatusChips';
import {
  BillingActionFeedbackDialog,
  BillingDialogContent,
  BillingEmptyState,
  BillingField,
  BillingSection,
} from '@/components/billing/BillingPrimitives';
import { FormControl } from '@/components/form/FormControl';
import { PaginationControls } from '@/components/ui/PaginationControls';
import api from '@/lib/api';
import { billingBeneficiaryLabel } from '@/lib/billing/billingLabels';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';
import { canManageBillingFinancial } from '@/lib/billing/billingFinancialAuth';

type TabId = 'driver' | 'operational_coop' | 'operational_flux' | 'other';
/** Trilha operacional dos APs de entregador: acerto semanal vs diárias (terça). */
type DriverPaymentTrack = 'acerto' | 'diarias' | 'all';
type PayableStatusChip = 'draft' | 'open' | 'blocked' | 'paid';
type PayDateShortcut = 'today' | 'this_week' | 'overdue' | '';
const PAYABLES_PAGE_SIZE = 20;

type DriverRow = DriverPharmacyLinkLike & { id: string; name: string };

function isFinancialDailyPayable(p: BillingPayable) {
  if (p.origin_type === 'financial_daily') return true;
  const meta = p.metadata && typeof p.metadata === 'object' ? p.metadata : null;
  return meta?.payment_kind === 'daily';
}

function filterPayables(rows: BillingPayable[], tab: TabId) {
  if (tab === 'driver') return rows.filter((p) => p.beneficiary_type === 'driver');
  if (tab === 'operational_coop')
    return rows.filter((p) => p.beneficiary_type === 'operational' && p.legal_entity_type === 'coop');
  if (tab === 'operational_flux')
    return rows.filter((p) => p.beneficiary_type === 'operational' && p.legal_entity_type === 'flux');
  return rows.filter(
    (p) =>
      p.beneficiary_type !== 'driver' &&
      !(p.beneficiary_type === 'operational' && (p.legal_entity_type === 'coop' || p.legal_entity_type === 'flux'))
  );
}

function filterDriverTrack(rows: BillingPayable[], track: DriverPaymentTrack) {
  if (track === 'diarias') return rows.filter(isFinancialDailyPayable);
  if (track === 'acerto') return rows.filter((p) => !isFinancialDailyPayable(p));
  return rows;
}

function categoryLabel(p: BillingPayable) {
  if (p.origin_type === 'financial_daily' || isFinancialDailyPayable(p)) return 'Diária (PIX terça)';
  if (p.origin_type === 'cycle_settlement') return 'Acerto semanal';
  if (p.origin_type === 'provider_advance_compensation') return 'Compensação de adiantamento';
  if (p.origin_type === 'quota_refund') return 'Devolução de cota';
  if (p.origin_type === 'driver_offboarding') return 'Acerto de desligamento';
  if (p.beneficiary_type === 'driver' && p.billing_cycle_id) return 'Acerto semanal';
  if (p.beneficiary_type === 'driver') return 'Repasse entregador';
  return billingBeneficiaryLabel(p.beneficiary_type);
}

function payableNetAmount(p: BillingPayable) {
  return p.net_amount_cents ?? p.amount_cents;
}

function payableBalance(p: BillingPayable) {
  return payableNetAmount(p) - p.amount_paid_cents;
}

function canOpenPayslip(p: BillingPayable) {
  return p.beneficiary_type === 'driver';
}

function isPayablePaid(p: BillingPayable) {
  return p.status === 'paid' || payableBalance(p) <= 0;
}

function matchesPayableStatus(p: BillingPayable, status: PayableStatusChip | '') {
  if (status === 'draft') return p.status === 'draft';
  if (status === 'blocked') return Boolean(p.payment_blocked);
  if (status === 'paid') return isPayablePaid(p);
  if (status === 'open') {
    return p.status === 'approved' && payableBalance(p) > 0 && !p.payment_blocked;
  }
  // Default: hide paid
  return !isPayablePaid(p) && p.status !== 'cancelled';
}

function payablePayDate(p: BillingPayable): string | null {
  return (p.scheduled_payment_date || p.due_date || null)?.slice(0, 10) || null;
}

function startOfWeekMonday(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00`);
  const day = d.getDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function endOfWeekSunday(isoDate: string): string {
  const start = new Date(`${startOfWeekMonday(isoDate)}T12:00:00`);
  start.setDate(start.getDate() + 6);
  return start.toISOString().slice(0, 10);
}

function matchesPayDateShortcut(p: BillingPayable, shortcut: PayDateShortcut, today: string) {
  if (!shortcut) return true;
  const date = payablePayDate(p);
  if (shortcut === 'today') return date === today;
  if (shortcut === 'this_week') {
    if (!date) return false;
    return date >= startOfWeekMonday(today) && date <= endOfWeekSunday(today);
  }
  if (shortcut === 'overdue') {
    return Boolean(date && date < today && payableBalance(p) > 0 && !isPayablePaid(p));
  }
  return true;
}

const STATUS_CHIP_OPTIONS: { id: PayableStatusChip; label: string }[] = [
  { id: 'draft', label: 'Rascunho' },
  { id: 'open', label: 'Em aberto' },
  { id: 'blocked', label: 'Bloqueado' },
  { id: 'paid', label: 'Pago' },
];

const PAY_DATE_OPTIONS: { id: PayDateShortcut; label: string }[] = [
  { id: 'today', label: 'Hoje' },
  { id: 'this_week', label: 'Esta semana' },
  { id: 'overdue', label: 'Vencidos' },
];

export function BillingPayablesPanel() {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useAuth((s) => s.user);
  const canManage = canManageBillingFinancial(user?.role, user?.permissions);
  const targetPayableId = searchParams.get('payable_id');
  const targetDriverId = searchParams.get('driver_id');
  const offboardingPreviewId = searchParams.get('offboarding_preview_id');
  const tabFromUrl = searchParams.get('tab');
  const [tab, setTab] = useState<TabId>(
    tabFromUrl === 'driver' || tabFromUrl === 'operational_coop' || tabFromUrl === 'operational_flux' || tabFromUrl === 'other'
      ? tabFromUrl
      : 'driver'
  );
  const trackFromUrl = searchParams.get('track');
  const [driverTrack, setDriverTrack] = useState<DriverPaymentTrack>(
    trackFromUrl === 'diarias' || trackFromUrl === 'all' || trackFromUrl === 'acerto' ? trackFromUrl : 'acerto'
  );
  const statusFromUrl = (searchParams.get('status') || '') as PayableStatusChip | '';
  const payDateFromUrl = (searchParams.get('pay_date') || '') as PayDateShortcut;
  const [baixa, setBaixa] = useState<BillingPayable | null>(null);
  const [payslipPayableId, setPayslipPayableId] = useState<string | null>(null);
  const [payrollMonth, setPayrollMonth] = useState(new Date().toISOString().slice(0, 7));
  const [costCenterFilter, setCostCenterFilter] = useState(searchParams.get('cost_center_id') || '');
  const [cycleFilter, setCycleFilter] = useState(readCycleParam(searchParams));
  const [pharmacyId, setPharmacyId] = useState(searchParams.get('pharmacy_id') || '');
  const [driverFilterId, setDriverFilterId] = useState(searchParams.get('driver_id') || '');
  const [beneficiaryQ, setBeneficiaryQ] = useState(searchParams.get('q') || '');
  const [statusFilter, setStatusFilter] = useState<PayableStatusChip | ''>(
    statusFromUrl === 'draft' ||
      statusFromUrl === 'open' ||
      statusFromUrl === 'blocked' ||
      statusFromUrl === 'paid'
      ? statusFromUrl
      : ''
  );
  const [payDateShortcut, setPayDateShortcut] = useState<PayDateShortcut>(
    payDateFromUrl === 'today' || payDateFromUrl === 'this_week' || payDateFromUrl === 'overdue' ? payDateFromUrl : ''
  );
  const [page, setPage] = useState(Number(searchParams.get('page') || 1));
  const [releaseTarget, setReleaseTarget] = useState<BillingPayable | null>(null);
  const [releaseReason, setReleaseReason] = useState('');
  const [feedback, setFeedback] = useState<{ title: string; description?: string; items?: string[] } | null>(null);
  /** Id vindo do deep link que deve permanecer visível mesmo com os filtros padrão. */
  const [focusPayableId, setFocusPayableId] = useState<string | null>(targetPayableId);
  const targetRowRef = useRef<HTMLTableRowElement | null>(null);

  const query = useQuery({
    queryKey: ['billing', 'payables', cycleFilter],
    queryFn: () => fetchBillingPayables(cycleFilter ? { cycle_id: cycleFilter } : undefined),
  });
  const cyclesQuery = useQuery({
    queryKey: ['billing', 'cycles'],
    queryFn: fetchBillingCycles,
  });
  const driversQuery = useQuery({
    queryKey: ['drivers', 'active', 'billing-filter'],
    queryFn: () => api.get('/api/drivers', { params: { status: 'active' } }).then((r) => r.data as DriverRow[]),
    enabled: tab === 'driver',
  });

  const linkedDriverIds = useMemo(() => {
    if (!pharmacyId) return null;
    return new Set(
      (driversQuery.data || [])
        .filter((d) => isDriverLinkedToPharmacy(d, pharmacyId))
        .map((d) => d.id)
    );
  }, [driversQuery.data, pharmacyId]);

  useEffect(() => {
    if (offboardingPreviewId) {
      router.replace(`/billing/desligamento/${offboardingPreviewId}`);
    }
  }, [offboardingPreviewId, router]);

  const all = useMemo(() => query.data || [], [query.data]);
  useEffect(() => {
    setFocusPayableId(targetPayableId);
  }, [targetPayableId]);

  useEffect(() => {
    const target = targetPayableId ? all.find((p) => p.id === targetPayableId) : null;
    if (target) {
      if (target.beneficiary_type === 'driver') {
        setTab('driver');
        // Diárias e acertos ficam em trilhas distintas: 'all' garante que o título alvo apareça.
        setDriverTrack('all');
      } else if (target.beneficiary_type === 'operational' && target.legal_entity_type === 'coop') setTab('operational_coop');
      else if (target.beneficiary_type === 'operational' && target.legal_entity_type === 'flux') setTab('operational_flux');
      else setTab('other');
    } else if (targetDriverId) {
      setTab('driver');
    }
  }, [all, targetDriverId, targetPayableId]);

  useEffect(() => {
    if (!targetPayableId) return;
    const el = targetRowRef.current;
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [targetPayableId, tab, driverTrack, all, focusPayableId]);

  useEffect(() => {
    setPage(1);
  }, [
    tab,
    costCenterFilter,
    cycleFilter,
    driverTrack,
    statusFilter,
    payDateShortcut,
    pharmacyId,
    driverFilterId,
    beneficiaryQ,
  ]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    if (tab === 'driver') {
      if (driverTrack === 'acerto') params.delete('track');
      else params.set('track', driverTrack);
    } else {
      params.delete('track');
    }
    writeCycleParam(params, cycleFilter);
    if (costCenterFilter) params.set('cost_center_id', costCenterFilter);
    else params.delete('cost_center_id');
    if (statusFilter) params.set('status', statusFilter);
    else params.delete('status');
    if (payDateShortcut) params.set('pay_date', payDateShortcut);
    else params.delete('pay_date');
    if (tab === 'driver') {
      if (pharmacyId) params.set('pharmacy_id', pharmacyId);
      else params.delete('pharmacy_id');
      if (driverFilterId) params.set('driver_id', driverFilterId);
      else params.delete('driver_id');
      params.delete('q');
    } else {
      params.delete('pharmacy_id');
      params.delete('driver_id');
      if (beneficiaryQ.trim()) params.set('q', beneficiaryQ.trim());
      else params.delete('q');
    }
    if (page > 1) params.set('page', String(page));
    else params.delete('page');
    replaceQueryIfChanged(router, '/billing/pagar', searchParams.toString(), params);
  }, [
    costCenterFilter,
    cycleFilter,
    driverTrack,
    page,
    router,
    searchParams,
    tab,
    statusFilter,
    payDateShortcut,
    pharmacyId,
    driverFilterId,
    beneficiaryQ,
  ]);

  const today = new Date().toISOString().slice(0, 10);

  const applyCommonFilters = (rows: BillingPayable[]) => {
    // O título do deep link nunca é escondido pelos filtros padrão (ex.: "Ativos (sem pagos)").
    const keepFocus = (p: BillingPayable) => Boolean(focusPayableId) && p.id === focusPayableId;
    let list = rows;
    if (costCenterFilter) list = list.filter((p) => keepFocus(p) || p.cost_center_id === costCenterFilter);
    list = list.filter((p) => keepFocus(p) || matchesPayableStatus(p, statusFilter));
    list = list.filter((p) => keepFocus(p) || matchesPayDateShortcut(p, payDateShortcut, today));
    return list;
  };

  const driverRows = useMemo(() => filterPayables(all, 'driver'), [all]);
  const trackCounts = useMemo(
    () => ({
      acerto: filterDriverTrack(driverRows, 'acerto').length,
      diarias: filterDriverTrack(driverRows, 'diarias').length,
      all: driverRows.length,
    }),
    [driverRows]
  );

  const counts = useMemo(
    () => ({
      driver: tab === 'driver' ? filterDriverTrack(driverRows, driverTrack).length : driverRows.length,
      operational_coop: filterPayables(all, 'operational_coop').length,
      operational_flux: filterPayables(all, 'operational_flux').length,
      other: filterPayables(all, 'other').length,
    }),
    [all, driverRows, driverTrack, tab]
  );

  const approveMut = useMutation({
    mutationFn: (id: string) => approveBillingPayable(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing', 'payables'] }),
  });

  const payMut = useMutation({
    mutationFn: ({
      id,
      amount_cents,
      legal_entity_id,
      payment_method,
      bank_account_id,
      card_last_four,
      card_brand,
    }: {
      id: string;
      amount_cents: number;
      legal_entity_id: string | null;
      payment_method: string;
      bank_account_id?: string | null;
      card_last_four?: string | null;
      card_brand?: string | null;
    }) => payBillingPayable(id, { amount_cents, legal_entity_id, payment_method, bank_account_id, card_last_four, card_brand }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['billing', 'payables'] });
      await qc.invalidateQueries({ queryKey: ['billing', 'payments'] });
      await qc.invalidateQueries({ queryKey: ['billing', 'payments-unreconciled'] });
      setBaixa(null);
    },
  });

  const releaseMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => releaseBillingPayable(id, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing', 'payables'] }),
  });

  const payrollMut = useMutation({
    mutationFn: () => generateCompanyPayroll(payrollMonth),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['billing', 'payables'] });
      setFeedback({
        title: 'Folha mensal gerada',
        description: 'Resumo da geração de AP mensal.',
        items: [`Sócios: ${res.shareholders}`, `Prestadores: ${res.providers}`],
      });
    },
  });

  const onPharmacyChange = (id: string) => {
    setPharmacyId(id);
    if (!id) setDriverFilterId('');
  };

  const renderTable = (rawList: BillingPayable[], opts?: { driverTab?: boolean }) => {
    let lista = applyCommonFilters(rawList);

    const keepFocus = (p: BillingPayable) => Boolean(focusPayableId) && p.id === focusPayableId;

    if (opts?.driverTab) {
      if (driverFilterId) {
        lista = lista.filter((p) => keepFocus(p) || p.beneficiary_id === driverFilterId);
      } else if (pharmacyId && linkedDriverIds) {
        lista = lista.filter((p) => keepFocus(p) || (p.beneficiary_id && linkedDriverIds.has(p.beneficiary_id)));
      }
    } else {
      const q = beneficiaryQ.trim().toLowerCase();
      if (q) {
        lista = lista.filter((p) => {
          if (keepFocus(p)) return true;
          const hay = `${p.description || ''} ${p.beneficiary_name || ''}`.toLowerCase();
          return hay.includes(q);
        });
      }
    }

    const pageCount = Math.max(1, Math.ceil(lista.length / PAYABLES_PAGE_SIZE));
    const focusIndex = focusPayableId ? lista.findIndex((p) => p.id === focusPayableId) : -1;
    const currentPage =
      focusIndex >= 0 ? Math.floor(focusIndex / PAYABLES_PAGE_SIZE) + 1 : Math.min(page, pageCount);
    const pageItems = lista.slice((currentPage - 1) * PAYABLES_PAGE_SIZE, currentPage * PAYABLES_PAGE_SIZE);
    return (
      <div>
        <div className={billingTableShellClassName}>
          <table className="w-full table-fixed text-sm">
            <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
              <tr>
                <th className="w-[24%] px-4 py-3">Descrição</th>
                <th className="w-[8%] px-4 py-3">Empresa</th>
                <th className="w-[13%] px-4 py-3">Centro de custo</th>
                <th className="w-[9%] px-4 py-3">Venc.</th>
                <th className="w-[9%] px-4 py-3">Pagto.</th>
                <th className="w-[12%] px-4 py-3 text-right">Valores</th>
                <th className="w-[8%] px-4 py-3">Saldo</th>
                <th className="w-[8%] px-4 py-3">Status</th>
                <th className="w-[9%] px-4 py-3">Lote</th>
                <th className="w-[10%] px-4 py-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((p) => {
                const netAmount = payableNetAmount(p);
                const grossAmount = p.gross_amount_cents ?? p.amount_cents;
                const compensatedAmount = p.compensated_amount_cents ?? Math.max(0, grossAmount - netAmount);
                const pendingPayment = p.pending_payment_cents || 0;
                const balance = netAmount - p.amount_paid_cents;
                const availableBalance = Math.max(0, balance - pendingPayment);
                const st = payableDisplayStatus(p.status, netAmount, p.amount_paid_cents, p.due_date);
                return (
                  <tr
                    key={p.id}
                    ref={p.id === targetPayableId ? targetRowRef : undefined}
                    className={cn(
                      'border-b border-border/40 align-top last:border-0',
                      p.id === targetPayableId && 'bg-primary/10 ring-1 ring-inset ring-primary/30',
                      canOpenPayslip(p) && 'cursor-pointer hover:bg-muted/40'
                    )}
                    onClick={() => {
                      if (canOpenPayslip(p)) setPayslipPayableId(p.id);
                    }}
                  >
                    <td className="px-4 py-2.5">
                      <button
                        type="button"
                        className="line-clamp-2 text-left font-medium leading-5 hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (canOpenPayslip(p)) setPayslipPayableId(p.id);
                        }}
                      >
                        {p.description || p.beneficiary_name || 'Conta a pagar'}
                      </button>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{categoryLabel(p)}</div>
                      {p.origin_type ? (
                        <div className="text-[10px] text-muted-foreground">Origem: {p.origin_type}</div>
                      ) : null}
                      {p.payment_blocked ? (
                        <div className={cn('mt-1 line-clamp-2 rounded-md px-2 py-1 text-[11px] leading-4', billingNoticeClassName('warning'))}>
                          Bloqueado: {p.block_reason || 'aguardando liberação'}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">
                      <BillingEntityBadge entity={p.legal_entity_type} />
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <div className="line-clamp-2">{p.billing_cost_centers?.name || '—'}</div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[11px]">{p.due_date ? fmtDate(p.due_date) : '—'}</td>
                    <td className="px-4 py-2.5 text-[11px]">
                      <div className="font-mono">{p.scheduled_payment_date ? fmtDate(p.scheduled_payment_date) : p.due_date ? fmtDate(p.due_date) : '—'}</div>
                      <div className="text-muted-foreground">{p.payment_method || 'pix'}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      <div className="font-semibold">{formatBrlCents(netAmount)}</div>
                      {pendingPayment > 0 ? (
                        <div className="text-[10px] text-warning">Baixa pend. {formatBrlCents(pendingPayment)}</div>
                      ) : null}
                      {compensatedAmount ? (
                        <div className="text-[10px] text-success">Comp. {formatBrlCents(compensatedAmount)}</div>
                      ) : null}
                      {grossAmount !== netAmount ? (
                        <div className="text-[10px] text-muted-foreground">Bruto {formatBrlCents(grossAmount)}</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5">
                      <BillingSaldoCell
                        amountCents={netAmount}
                        amountPaidCents={p.amount_paid_cents}
                        status={p.status}
                        dueDate={p.due_date}
                      />
                    </td>
                    <td className={cn('px-4 py-2.5 text-xs font-medium', pendingPayment > 0 ? 'text-warning' : st.className)}>
                      {pendingPayment > 0 ? 'Baixa pendente' : st.label}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {p.payment_batch_status === 'exported' ? (
                        <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">Exportado</span>
                      ) : p.batch_eligible === false ? (
                        <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">Não elegível</span>
                      ) : (
                        <span className="rounded-full bg-surface px-2 py-1 text-[10px] text-muted-foreground">Pendente</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex min-w-[74px] justify-end gap-2">
                        {canManage && p.payment_blocked ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 border-primary/30 bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/15 hover:text-primary"
                            onClick={() => {
                              setReleaseTarget(p);
                              setReleaseReason('');
                            }}
                            disabled={releaseMut.isPending}
                          >
                            Liberar
                          </Button>
                        ) : null}
                        {canManage && p.status === 'draft' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-3 text-xs"
                            onClick={() => approveMut.mutate(p.id)}
                          >
                            Aprovar
                          </Button>
                        ) : null}
                        {canManage &&
                        availableBalance > 0 &&
                        p.status !== 'draft' &&
                        p.status !== 'cancelled' &&
                        !p.payment_blocked ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-3 text-xs"
                            onClick={() => setBaixa(p)}
                          >
                            Registrar baixa
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!lista.length && !query.isLoading ? (
                <tr>
                  <td colSpan={10} className="p-4">
                    <BillingEmptyState>Nenhum lançamento.</BillingEmptyState>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {lista.length > PAYABLES_PAGE_SIZE ? (
          <PaginationControls
            className="px-4"
            page={currentPage}
            pageSize={PAYABLES_PAGE_SIZE}
            totalItems={lista.length}
            onPageChange={(next) => {
              setFocusPayableId(null);
              setPage(next);
            }}
            itemLabel="títulos"
          />
        ) : null}
      </div>
    );
  };

  return (
    <BillingSection
      title="A pagar"
      desc="Acerto semanal (quinta) e diárias (terça) ficam em trilhas separadas. Folha e despesas operacionais nas demais abas."
      icon={ArrowUpFromLine}
    >
      <div className="flex flex-wrap items-end gap-3">
        <BillingCycleSelect
          value={cycleFilter}
          onChange={setCycleFilter}
          cycles={cyclesQuery.data || []}
          allowEmpty
          emptyLabel="Todos"
          className="min-w-56"
        />
        <BillingCostCenterFilter value={costCenterFilter} onChange={setCostCenterFilter} className="min-w-56" />
        <BillingField label="Gerar folha">
          <FormControl
            type="month"
            inputSize="sm"
            className="mt-1 w-36"
            value={payrollMonth}
            onChange={(e) => setPayrollMonth(e.target.value)}
          />
        </BillingField>
        <Button size="sm" variant="outline" onClick={() => payrollMut.mutate()} disabled={payrollMut.isPending}>
          Gerar AP mensal
        </Button>
      </div>

      <div className="space-y-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">Status</span>
        <BillingStatusChips
          value={statusFilter}
          onChange={setStatusFilter}
          options={STATUS_CHIP_OPTIONS}
          allLabel="Ativos (sem pagos)"
        />
      </div>

      <div className="space-y-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">Data de pagamento</span>
        <BillingStatusChips
          value={payDateShortcut}
          onChange={setPayDateShortcut}
          options={PAY_DATE_OPTIONS}
          allLabel="Qualquer data"
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)}>
        <TabsList className={billingTabsListClassName}>
          <TabsTrigger value="driver" className={billingTabsTriggerClassName}>
            Entregadores · {counts.driver}
          </TabsTrigger>
          <TabsTrigger value="operational_coop" className={billingTabsTriggerClassName}>
            Operacional · Coop · {counts.operational_coop}
          </TabsTrigger>
          <TabsTrigger value="operational_flux" className={billingTabsTriggerClassName}>
            Operacional · Flux · {counts.operational_flux}
          </TabsTrigger>
          {counts.other > 0 ? (
            <TabsTrigger value="other" className={billingTabsTriggerClassName}>
              Outros · {counts.other}
            </TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value="driver" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <BillingPharmacyFilter value={pharmacyId} onChange={onPharmacyChange} className="min-w-[200px]" />
            <BillingDriverFilter
              value={driverFilterId}
              onChange={setDriverFilterId}
              pharmacyId={pharmacyId}
              className="min-w-[200px]"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-subtle-foreground">Trilha</span>
            {(
              [
                { id: 'acerto' as const, label: `Acerto semanal · ${trackCounts.acerto}` },
                { id: 'diarias' as const, label: `Diárias · ${trackCounts.diarias}` },
                { id: 'all' as const, label: `Todos · ${trackCounts.all}` },
              ] as const
            ).map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => setDriverTrack(chip.id)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  driverTrack === chip.id
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border bg-surface text-muted-foreground hover:border-primary/30 hover:text-foreground'
                )}
              >
                {chip.label}
              </button>
            ))}
            {driverTrack === 'diarias' ? (
              <a
                href="/billing/relatorios/pagamento-pix-diarias"
                className="text-xs text-primary underline-offset-2 hover:underline"
              >
                Exportar PIX diárias →
              </a>
            ) : null}
          </div>
          {driverTrack === 'acerto' ? (
            <p className="text-[11px] text-muted-foreground">
              Lista padrão do acerto (quinta). Diárias pagas na terça ficam na trilha Diárias / relatório dedicado.
            </p>
          ) : null}
          {renderTable(filterDriverTrack(driverRows, driverTrack), { driverTab: true })}
        </TabsContent>
        <TabsContent value="operational_coop" className="mt-4 space-y-3">
          <BillingField label="Buscar beneficiário" className="max-w-sm">
            <FormControl
              inputSize="sm"
              className="mt-1"
              value={beneficiaryQ}
              placeholder="Nome ou descrição…"
              onChange={(e) => setBeneficiaryQ(e.target.value)}
            />
          </BillingField>
          {renderTable(filterPayables(all, 'operational_coop'))}
        </TabsContent>
        <TabsContent value="operational_flux" className="mt-4 space-y-3">
          <BillingField label="Buscar beneficiário" className="max-w-sm">
            <FormControl
              inputSize="sm"
              className="mt-1"
              value={beneficiaryQ}
              placeholder="Nome ou descrição…"
              onChange={(e) => setBeneficiaryQ(e.target.value)}
            />
          </BillingField>
          {renderTable(filterPayables(all, 'operational_flux'))}
        </TabsContent>
        {counts.other > 0 ? (
          <TabsContent value="other" className="mt-4 space-y-3">
            <BillingField label="Buscar beneficiário" className="max-w-sm">
              <FormControl
                inputSize="sm"
                className="mt-1"
                value={beneficiaryQ}
                placeholder="Nome ou descrição…"
                onChange={(e) => setBeneficiaryQ(e.target.value)}
              />
            </BillingField>
            {renderTable(filterPayables(all, 'other'))}
          </TabsContent>
        ) : null}
      </Tabs>

      {baixa ? (
        <BillingBaixaDialog
          open={!!baixa}
          onOpenChange={(v) => !v && setBaixa(null)}
          title="Baixa a pagar"
          balanceCents={Math.max(0, payableNetAmount(baixa) - baixa.amount_paid_cents - (baixa.pending_payment_cents || 0))}
          defaultEntityType={baixa.legal_entity_type || 'coop'}
          costCenterName={baixa.billing_cost_centers?.name || null}
          loading={payMut.isPending}
          onConfirm={(input) =>
            payMut.mutate({
              id: baixa.id,
              ...input,
              amount_cents: Math.min(input.amount_cents, Math.max(0, payableNetAmount(baixa) - baixa.amount_paid_cents - (baixa.pending_payment_cents || 0))),
            })
          }
        />
      ) : null}
      <BillingPayslipDrawer payableId={payslipPayableId} onClose={() => setPayslipPayableId(null)} />
      <Dialog open={Boolean(releaseTarget)} onOpenChange={(open) => !open && setReleaseTarget(null)}>
        {releaseTarget ? (
          <BillingDialogContent
            title="Liberar pagamento bloqueado"
            description="Informe a justificativa gerencial. A liberação fica registrada no título."
            footer={
              <>
                <Button variant="outline" onClick={() => setReleaseTarget(null)} disabled={releaseMut.isPending}>
                  Cancelar
                </Button>
                <Button
                  disabled={releaseReason.trim().length < 3 || releaseMut.isPending}
                  onClick={() => {
                    releaseMut.mutate({ id: releaseTarget.id, reason: releaseReason.trim() });
                    setReleaseTarget(null);
                  }}
                >
                  Confirmar liberação
                </Button>
              </>
            }
          >
            <div className="rounded-lg border border-border bg-background/40 px-3 py-2 text-xs">
              <div className="font-medium">{releaseTarget.description || releaseTarget.beneficiary_name || 'Título a pagar'}</div>
              <div className="mt-1 text-muted-foreground">{formatBrlCents(payableNetAmount(releaseTarget))}</div>
            </div>
            <BillingField label="Justificativa">
              <FormControl
                className="mt-1"
                value={releaseReason}
                placeholder="Ex.: liberação aprovada pelo gestor após conferência"
                onChange={(e) => setReleaseReason(e.target.value)}
              />
            </BillingField>
          </BillingDialogContent>
        ) : null}
      </Dialog>
      <Dialog open={Boolean(feedback)} onOpenChange={(open) => !open && setFeedback(null)}>
        {feedback ? (
          <BillingActionFeedbackDialog
            open={Boolean(feedback)}
            onOpenChange={(open) => !open && setFeedback(null)}
            title={feedback.title}
            description={feedback.description}
            items={feedback.items}
          />
        ) : null}
      </Dialog>
    </BillingSection>
  );
}
