'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  BillingActionFeedbackDialog,
  BillingDialogContent,
  BillingEmptyState,
  BillingField,
  BillingSection,
} from '@/components/billing/BillingPrimitives';
import { BillingStatusChips } from '@/components/billing/BillingStatusChips';
import { BillingPaymentDetailDrawer } from '@/components/billing/BillingPaymentDetailDrawer';
import { FormSelect } from '@/components/form/FormSelect';
import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';
import { FormControl } from '@/components/form/FormControl';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { useClientPagination } from '@/lib/billing/billingListUtils';
import { replaceQueryIfChanged } from '@/lib/billing/billingFilterUrl';
import { cn } from '@/lib/utils';
import {
  type BillingBankMovement,
  type BillingBankStatementFormat,
  type BillingInvoice,
  type BillingPayable,
  detectBillingBankStatementFormat,
  fetchBankAccounts,
  fetchBankMovements,
  fetchBillingPayments,
  fetchBillingInvoices,
  fetchBillingPayables,
  fetchUnreconciledPayments,
  importBankMovements,
  manualSettleBankMovement,
  reconcileBankMovement,
  settleInvoiceWithInterest,
} from '@/lib/billing/billingApi';
import { interestCentsForCredit, invoiceAvailableCents } from '@/lib/billing/billingInterest';
import { buildDebitPayableSuggestions } from '@/lib/billing/billingDebitPayableSuggestions';
import { formatBrlCents, fmtDate } from '@/lib/billing/billingFormat';
import { billingTableShellClassName } from '@/lib/billing/billingReviveUi';

const MOVEMENTS_PAGE_SIZE = 20;
const PAYMENTS_PAGE_SIZE = 20;
type PaymentKindFilter =
  | 'all'
  | 'receivable'
  | 'payable'
  | 'leader_commission'
  | 'partner_commission'
  | 'driver'
  | 'operational'
  | 'coop'
  | 'flux';
type PaymentReconcileChip = 'reconciled' | 'pending';
type ManualSettleResult = {
  ok: boolean;
  payment_id?: string;
  warning?: string | null;
  result?: { interest_cents?: number; pending_payments_removed?: number };
};

function PaymentStatusBadge({ reconciled }: { reconciled?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium',
        reconciled
          ? 'border-success/40 bg-success/10 text-success'
          : 'border-warning/40 bg-warning/10 text-warning'
      )}
    >
      {reconciled ? 'Conciliada' : 'Pendente'}
    </span>
  );
}

export function BillingConciliacaoPanel() {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetMovementId = searchParams.get('movement_id');
  const targetPaymentId = searchParams.get('payment_id');
  const [accountId, setAccountId] = useState('');
  const [format, setFormat] = useState<BillingBankStatementFormat>('c6');
  const [fileContent, setFileContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [linkPayment, setLinkPayment] = useState<Record<string, string>>({});
  const [showImport, setShowImport] = useState(false);
  const [directionFilter, setDirectionFilter] = useState<'all' | 'credit' | 'debit'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'reconciled'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [movementSearch, setMovementSearch] = useState('');
  const [paymentKindFilter, setPaymentKindFilter] = useState<PaymentKindFilter>('all');
  const [paymentSearch, setPaymentSearch] = useState('');
  const [paymentReconcileFilter, setPaymentReconcileFilter] = useState<PaymentReconcileChip | ''>('');
  const [detailPaymentId, setDetailPaymentId] = useState<string | null>(null);
  const [ignoredSuggestionIds, setIgnoredSuggestionIds] = useState<string[]>([]);
  const [manualMovement, setManualMovement] = useState<BillingBankMovement | null>(null);
  const [manualTargetId, setManualTargetId] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [manualInterestReason, setManualInterestReason] = useState('');
  const [feedback, setFeedback] = useState<{ title: string; description?: string; items?: string[] } | null>(null);
  const targetMovementRowRef = useRef<HTMLTableRowElement | null>(null);

  const accountsQuery = useQuery({ queryKey: ['billing', 'bank-accounts'], queryFn: () => fetchBankAccounts({ active: true }) });
  const pendingPaymentsQuery = useQuery({ queryKey: ['billing', 'payments-unreconciled'], queryFn: fetchUnreconciledPayments });
  const registeredPaymentsQuery = useQuery({
    queryKey: ['billing', 'payments', 'conciliation'],
    queryFn: () => fetchBillingPayments(),
  });
  const invoicesQuery = useQuery({ queryKey: ['billing', 'invoices', 'manual-settlement'], queryFn: () => fetchBillingInvoices() });
  const payablesQuery = useQuery({ queryKey: ['billing', 'payables', 'manual-settlement'], queryFn: () => fetchBillingPayables() });
  const movementsQuery = useQuery({
    queryKey: ['billing', 'bank-movements', accountId],
    queryFn: () => fetchBankMovements({ bank_account_id: accountId || undefined }),
    enabled: !!accountId || !!targetMovementId,
  });

  useEffect(() => {
    if (!targetMovementId || accountId) return;
    const movement = (movementsQuery.data || []).find((m) => m.id === targetMovementId);
    if (movement?.bank_account_id) setAccountId(movement.bank_account_id);
  }, [accountId, movementsQuery.data, targetMovementId]);

  useEffect(() => {
    if (targetPaymentId) setDetailPaymentId(targetPaymentId);
  }, [targetPaymentId]);

  useEffect(() => {
    setIgnoredSuggestionIds([]);
  }, [accountId]);

  const importMut = useMutation({
    mutationFn: () => importBankMovements(accountId, format, fileContent),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['billing', 'bank-movements'] });
      await qc.invalidateQueries({ queryKey: ['billing', 'payments-unreconciled'] });
      await qc.invalidateQueries({ queryKey: ['billing', 'payments'] });
      await qc.invalidateQueries({ queryKey: ['billing', 'audit-notifications'] });
      await qc.invalidateQueries({ queryKey: ['billing', 'treasury-summary'] });
      setFileContent('');
      setFileName('');
      setFileError(null);
      const byDate = res.parse_stats?.by_date || {};
      const recentDates = Object.keys(byDate)
        .sort()
        .slice(-6)
        .map((d) => `${d}: ${byDate[d]}`)
        .join(' · ');
      setFeedback({
        title: 'Extrato importado',
        description: 'Resumo da leitura e conciliação automática.',
        items: [
          `Formato: ${res.format || format}${res.format_requested && res.format_requested !== res.format ? ` (solicitado: ${res.format_requested})` : ''}`,
          `Lidos: ${res.parsed}`,
          `Importados: ${res.imported}; ignorados (já existentes): ${res.skipped}`,
          `Conciliados automaticamente: ${res.auto_reconciled}; para revisão: ${res.review_required}`,
          `Sem vínculo: ${res.unmatched}; baixas sem movimento: ${res.payment_without_movement}`,
          ...(res.auto_reconcile_pending
            ? [`Conciliação automática pendente para mais ${res.auto_reconcile_pending} movimento(s) — use a tela de conciliação.`]
            : []),
          ...(recentDates ? [`Por data (últimas): ${recentDates}`] : []),
        ],
      });
    },
    onError: (err: unknown) => {
      const ax = err as { response?: { data?: { error?: string; hint?: string; parse_stats?: { total?: number } } }; message?: string };
      const data = ax.response?.data;
      setFeedback({
        title: 'Falha na importação',
        description: data?.error || ax.message || 'Não foi possível importar o extrato.',
        items: [
          ...(data?.hint ? [data.hint] : ['Se parou no meio, reimporte o mesmo arquivo — duplicados já gravados serão ignorados.']),
          ...(typeof data?.parse_stats?.total === 'number' ? [`Linhas reconhecidas no arquivo: ${data.parse_stats.total}`] : []),
        ],
      });
    },
  });

  const reconcileMut = useMutation({
    mutationFn: ({ movementId, paymentId }: { movementId: string; paymentId: string }) =>
      reconcileBankMovement(movementId, paymentId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['billing', 'bank-movements'] });
      await qc.invalidateQueries({ queryKey: ['billing', 'payments-unreconciled'] });
      await qc.invalidateQueries({ queryKey: ['billing', 'payments'] });
      await qc.invalidateQueries({ queryKey: ['billing', 'treasury-summary'] });
    },
  });

  const manualSettleMut = useMutation({
    mutationFn: ({
      movementId,
      targetId,
      targetType,
      notes,
      interestReason,
      interestCents,
    }: {
      movementId: string;
      targetId: string;
      targetType: 'invoice' | 'payable';
      notes?: string | null;
      interestReason?: string;
      interestCents?: number;
    }): Promise<ManualSettleResult> => {
      if (targetType === 'invoice' && (interestCents || 0) > 0) {
        return settleInvoiceWithInterest(movementId, {
          invoice_id: targetId,
          reason: interestReason || '',
          notes,
        });
      }
      return manualSettleBankMovement(movementId, { target_type: targetType, target_id: targetId, notes });
    },
    onSuccess: async (res) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['billing', 'bank-movements'] }),
        qc.invalidateQueries({ queryKey: ['billing', 'payments-unreconciled'] }),
        qc.invalidateQueries({ queryKey: ['billing', 'payments'] }),
        qc.invalidateQueries({ queryKey: ['billing', 'invoices'] }),
        qc.invalidateQueries({ queryKey: ['billing', 'payables'] }),
        qc.invalidateQueries({ queryKey: ['billing', 'treasury-summary'] }),
      ]);
      setManualMovement(null);
      setManualTargetId('');
      setManualNotes('');
      setManualInterestReason('');
      const interestCents = res.result?.interest_cents;
      if (res.warning) {
        setFeedback({ title: 'Baixa manual registrada com alerta', description: res.warning });
      } else if (interestCents && interestCents > 0) {
        setFeedback({
          title: 'Juros lançados e movimento conciliado',
          description: `Diferença de ${formatBrlCents(interestCents)} registrada como juros/receita financeira.`,
        });
      } else {
        setFeedback({ title: 'Baixa manual conciliada', description: 'Movimento e título foram vinculados com sucesso.' });
      }
    },
  });

  const confirmSuggestionMut = useMutation({
    mutationFn: async (items: Array<{ movementId: string; payableId: string }>) => {
      const results: Array<{ movementId: string; ok: boolean; error?: string }> = [];
      for (const item of items) {
        try {
          await manualSettleBankMovement(item.movementId, {
            target_type: 'payable',
            target_id: item.payableId,
            notes: 'Baixa confirmada a partir de sugestão de conciliação',
          });
          results.push({ movementId: item.movementId, ok: true });
        } catch (err) {
          results.push({
            movementId: item.movementId,
            ok: false,
            error: err instanceof Error ? err.message : 'Falha ao confirmar',
          });
        }
      }
      return results;
    },
    onSuccess: async (results) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['billing', 'bank-movements'] }),
        qc.invalidateQueries({ queryKey: ['billing', 'payments-unreconciled'] }),
        qc.invalidateQueries({ queryKey: ['billing', 'payments'] }),
        qc.invalidateQueries({ queryKey: ['billing', 'payables'] }),
        qc.invalidateQueries({ queryKey: ['billing', 'treasury-summary'] }),
      ]);
      const ok = results.filter((r) => r.ok).length;
      const fail = results.filter((r) => !r.ok);
      setFeedback({
        title: ok ? 'Sugestões confirmadas' : 'Nenhuma sugestão confirmada',
        description:
          fail.length === 0
            ? `${ok} baixa(s) criada(s) e conciliada(s) com o extrato.`
            : `${ok} confirmada(s); ${fail.length} com erro.`,
        items: fail.map((f) => f.error || f.movementId).slice(0, 6),
      });
    },
  });

  const onFile = async (file: File | null) => {
    setFileError(null);
    setFileContent('');
    setFileName(file?.name || '');
    if (!file) return;
    setFileLoading(true);
    try {
      const text = await file.text();
      if (!text.trim()) {
        setFileError('O arquivo selecionado está vazio.');
        return;
      }
      const detected = detectBillingBankStatementFormat(text);
      setFormat(detected);
      setFileContent(text);
    } catch {
      setFileError('Não foi possível ler o arquivo selecionado.');
    } finally {
      setFileLoading(false);
    }
  };

  const accounts = accountsQuery.data || [];
  const pendingPayments = pendingPaymentsQuery.data || [];
  const allPayments = registeredPaymentsQuery.data || [];
  const registeredPayments = allPayments.filter((payment) => {
    if (!accountId) return false;
    return payment.bank_account_id === accountId || (!payment.reconciled && !payment.bank_account_id);
  });
  const movements = movementsQuery.data || [];
  const invoices = invoicesQuery.data || [];
  const payables = payablesQuery.data || [];
  const payablesById = useMemo(() => new Map(payables.map((payable) => [payable.id, payable])), [payables]);

  const normalizeSearch = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  const paymentPayable = (payment: (typeof pendingPayments)[number] | (typeof registeredPayments)[number]) =>
    payment.payable_id ? payablesById.get(payment.payable_id) || payment.billing_payables || null : null;

  const paymentKind = (payment: (typeof pendingPayments)[number] | (typeof registeredPayments)[number]): PaymentKindFilter => {
    if (payment.invoice_id) return 'receivable';
    const payable = paymentPayable(payment);
    if (!payable) return payment.payable_id ? 'payable' : 'all';
    if (payable.beneficiary_type === 'leader') return 'leader_commission';
    if (payable.beneficiary_type === 'commercial_partner') return 'partner_commission';
    if (payable.beneficiary_type === 'driver') return 'driver';
    if (payable.beneficiary_type === 'operational') return 'operational';
    return 'payable';
  };

  const paymentSearchText = (payment: (typeof pendingPayments)[number] | (typeof registeredPayments)[number]) => {
    const payable = paymentPayable(payment);
    const invoice = payment.billing_invoices || null;
    const pharmacy = invoice?.pharmacies?.trade_name || invoice?.pharmacies?.legal_name || '';
    const raw = [
      payment.amount_cents,
      formatBrlCents(payment.amount_cents),
      payment.payment_method,
      payable?.description,
      payable?.beneficiary_name,
      payable?.beneficiary_type,
      payable?.category,
      payable?.origin_type,
      payable?.legal_entity_type,
      invoice?.due_date,
      pharmacy,
    ];
    return normalizeSearch(raw.filter(Boolean).join(' '));
  };

  const matchesPaymentFilters = (payment: (typeof pendingPayments)[number] | (typeof registeredPayments)[number]) => {
    const payable = paymentPayable(payment);
    const kind = paymentKind(payment);
    if (paymentKindFilter === 'receivable' && payment.invoice_id == null) return false;
    if (paymentKindFilter === 'payable' && payment.payable_id == null) return false;
    if (paymentKindFilter === 'leader_commission' && kind !== 'leader_commission') return false;
    if (paymentKindFilter === 'partner_commission' && kind !== 'partner_commission') return false;
    if (paymentKindFilter === 'driver' && kind !== 'driver') return false;
    if (paymentKindFilter === 'operational' && kind !== 'operational') return false;
    if (paymentKindFilter === 'coop' && payable?.legal_entity_type !== 'coop') return false;
    if (paymentKindFilter === 'flux' && payable?.legal_entity_type !== 'flux') return false;
    const search = normalizeSearch(paymentSearch.trim());
    if (search && !paymentSearchText(payment).includes(search)) return false;
    return true;
  };

  const filteredRegisteredPayments = registeredPayments.filter((payment) => {
    if (!matchesPaymentFilters(payment)) return false;
    if (paymentReconcileFilter === 'reconciled' && !payment.reconciled) return false;
    if (paymentReconcileFilter === 'pending' && payment.reconciled) return false;
    return true;
  });
  const filteredPendingPayments = pendingPayments.filter(matchesPaymentFilters);

  const movementByPaymentId = useMemo(() => {
    const map = new Map<string, BillingBankMovement>();
    for (const m of movements) {
      if (m.billing_payment_id) map.set(m.billing_payment_id, m);
    }
    return map;
  }, [movements]);

  // Deep link ?payment_id=: the list is scoped by conta, so adopt the payment's account.
  useEffect(() => {
    if (!targetPaymentId || accountId) return;
    const payment = allPayments.find((p) => p.id === targetPaymentId);
    if (payment?.bank_account_id) setAccountId(payment.bank_account_id);
  }, [accountId, allPayments, targetPaymentId]);

  const detailPayment = useMemo(
    () =>
      detailPaymentId
        ? filteredRegisteredPayments.find((p) => p.id === detailPaymentId) ||
          registeredPayments.find((p) => p.id === detailPaymentId) ||
          allPayments.find((p) => p.id === detailPaymentId) ||
          null
        : null,
    [allPayments, detailPaymentId, filteredRegisteredPayments, registeredPayments]
  );

  const filteredMovements = useMemo(() => {
    const search = normalizeSearch(movementSearch.trim());
    return movements.filter((m) => {
      const date = String(m.movement_date).slice(0, 10);
      if (directionFilter !== 'all' && m.direction !== directionFilter) return false;
      if (statusFilter === 'open' && m.reconciled) return false;
      if (statusFilter === 'reconciled' && !m.reconciled) return false;
      if (dateFrom && date < dateFrom) return false;
      if (dateTo && date > dateTo) return false;
      const haystack = normalizeSearch(
        [m.description, m.amount_cents, formatBrlCents(m.amount_cents), date, m.direction === 'debit' ? 'saida debito' : 'entrada credito']
          .filter(Boolean)
          .join(' ')
      );
      if (search && !haystack.includes(search)) return false;
      return true;
    });
  }, [dateFrom, dateTo, directionFilter, movementSearch, movements, statusFilter]);

  const movementsPagination = useClientPagination(filteredMovements, MOVEMENTS_PAGE_SIZE);
  const paymentsPagination = useClientPagination(filteredRegisteredPayments, PAYMENTS_PAGE_SIZE);

  useEffect(() => {
    movementsPagination.resetPage();
  }, [accountId, dateFrom, dateTo, directionFilter, movementSearch, statusFilter]);

  // Deep link ?movement_id=: navega até a página que contém o movimento e rola até a linha.
  useEffect(() => {
    if (!targetMovementId) return;
    const index = filteredMovements.findIndex((m) => m.id === targetMovementId);
    if (index < 0) return;
    movementsPagination.setPage(Math.floor(index / MOVEMENTS_PAGE_SIZE) + 1);
  }, [filteredMovements, movementsPagination.setPage, targetMovementId]);

  useEffect(() => {
    if (!targetMovementId) return;
    const el = targetMovementRowRef.current;
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [movementsPagination.page, targetMovementId, filteredMovements]);

  useEffect(() => {
    paymentsPagination.resetPage();
  }, [accountId, paymentKindFilter, paymentSearch, paymentReconcileFilter]);

  const pendingInvoicePayments = useMemo(() => {
    const map = new Map<string, number>();
    for (const payment of pendingPayments) {
      if (payment.invoice_id) {
        map.set(payment.invoice_id, (map.get(payment.invoice_id) || 0) + payment.amount_cents);
      }
    }
    return map;
  }, [pendingPayments]);

  const pendingPayablePayments = useMemo(() => {
    const map = new Map<string, number>();
    for (const payment of pendingPayments) {
      if (payment.payable_id) {
        map.set(payment.payable_id, (map.get(payment.payable_id) || 0) + payment.amount_cents);
      }
    }
    return map;
  }, [pendingPayments]);

  const movementIdsWithPendingPayment = useMemo(() => {
    const ids = new Set<string>();
    for (const m of movements) {
      if (m.reconciled || m.direction !== 'debit') continue;
      const hasPending = filteredPendingPayments.some((payment) => {
        if (!payment.payable_id) return false;
        if (payment.amount_cents !== m.amount_cents) return false;
        if (payment.bank_account_id && payment.bank_account_id !== m.bank_account_id) return false;
        return true;
      });
      if (hasPending) ids.add(m.id);
    }
    return ids;
  }, [movements, filteredPendingPayments]);

  const debitSuggestions = useMemo(() => {
    if (!accountId) return [];
    return buildDebitPayableSuggestions({
      movements,
      payables: payables.map((p) => ({
        id: p.id,
        description: p.description || null,
        beneficiary_name: p.beneficiary_name || null,
        due_date: p.due_date || null,
        amount_cents: p.amount_cents,
        amount_paid_cents: p.amount_paid_cents,
        status: p.status,
        payment_blocked: p.payment_blocked,
      })),
      pendingByPayableId: pendingPayablePayments,
      movementIdsWithPendingPayment,
      ignoredMovementIds: ignoredSuggestionIds,
    });
  }, [accountId, ignoredSuggestionIds, movementIdsWithPendingPayment, movements, payables, pendingPayablePayments]);

  const highConfidenceSuggestions = debitSuggestions.filter((s) => s.high_confidence);

  const goToMovement = (movementId: string) => {
    const movement = movements.find((m) => m.id === movementId) || null;
    // Limpa filtros que poderiam esconder o movimento alvo.
    setStatusFilter(movement?.reconciled ? 'reconciled' : 'all');
    setDirectionFilter('all');
    setDateFrom('');
    setDateTo('');
    setMovementSearch('');
    const params = new URLSearchParams(searchParams.toString());
    params.set('movement_id', movementId);
    params.delete('payment_id');
    replaceQueryIfChanged(router, '/billing/conciliacao', searchParams.toString(), params);
  };

  const accountLabel = (id: string | null) => {
    if (!id) return '—';
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.bank_name || a.name} ${a.account_number || ''}` : id.slice(0, 8);
  };

  const invoiceLabel = (invoice: BillingInvoice) => {
    const pharmacy = invoice.pharmacies?.trade_name || invoice.pharmacies?.legal_name || 'Farmácia sem nome';
    const balance = invoice.total_cents - invoice.amount_paid_cents;
    return `${pharmacy} · ${formatBrlCents(balance)} · venc. ${invoice.due_date || 'sem venc.'}`;
  };

  const payableLabel = (payable: BillingPayable) => {
    const balance = payable.amount_cents - payable.amount_paid_cents;
    return `${payable.description || payable.beneficiary_name || 'Título a pagar'} · ${formatBrlCents(balance)} · venc. ${payable.due_date || 'sem venc.'}`;
  };

  const paymentTargetLabel = (payment: (typeof registeredPayments)[number]) => {
    if (payment.billing_invoices) {
      const pharmacy =
        payment.billing_invoices.pharmacies?.trade_name ||
        payment.billing_invoices.pharmacies?.legal_name ||
        'Farmácia sem nome';
      return {
        type: 'A receber',
        detail: `${pharmacy} · venc. ${payment.billing_invoices.due_date || 'sem venc.'}`,
      };
    }
    if (payment.payable_id) {
      const payable = paymentPayable(payment);
      return {
        type:
          payable?.beneficiary_type === 'leader'
            ? 'Comissão líder'
            : payable?.beneficiary_type === 'commercial_partner'
              ? 'Comissão parceiro'
              : 'A pagar',
        detail: `${payable?.description || 'Título a pagar'} · ${payable?.beneficiary_name || payable?.beneficiary_type || 'sem beneficiário'} · venc. ${payable?.due_date || 'sem venc.'}`,
      };
    }
    return { type: payment.invoice_id ? 'A receber' : payment.payable_id ? 'A pagar' : 'Baixa', detail: payment.payment_method || 'Sem vínculo' };
  };

  const paymentOptionLabel = (payment: (typeof pendingPayments)[number]) => {
    const target = paymentTargetLabel(payment as (typeof registeredPayments)[number]);
    return `${target.type} · ${formatBrlCents(payment.amount_cents)} · ${target.detail}`;
  };

  const compatiblePendingPaymentsForMovement = (movement: BillingBankMovement) =>
    filteredPendingPayments.filter((payment) => {
      const directionMatches = movement.direction === 'credit' ? !!payment.invoice_id : !!payment.payable_id;
      if (!directionMatches) return false;
      if (payment.amount_cents !== movement.amount_cents) return false;
      if (payment.bank_account_id && payment.bank_account_id !== movement.bank_account_id) return false;
      return true;
    });

  const manualTargetType: 'invoice' | 'payable' | null = manualMovement
    ? manualMovement.direction === 'credit'
      ? 'invoice'
      : 'payable'
    : null;
  const manualEligiblePayables = manualMovement
    ? payables
        .filter((payable) => payable.status === 'approved' && !payable.payment_blocked)
        .filter((payable) => {
          const pending = pendingPayablePayments.get(payable.id) || 0;
          return payable.amount_cents - payable.amount_paid_cents - pending >= manualMovement.amount_cents;
        })
    : [];
  const manualApprovedPayables = payables.filter((payable) => payable.status === 'approved' && !payable.payment_blocked);
  const manualTargetOptions = manualMovement
    ? manualMovement.direction === 'credit'
      ? invoices
          .filter((invoice) => invoice.status !== 'draft' && invoice.status !== 'paid')
          .filter((invoice) => {
            const pending = pendingInvoicePayments.get(invoice.id) || 0;
            const available = invoiceAvailableCents({
              totalCents: invoice.total_cents,
              amountPaidCents: invoice.amount_paid_cents,
              pendingUnreconciledCents: pending,
            });
            return available > 0 && available <= manualMovement.amount_cents;
          })
          .sort((a, b) => {
            const avA = invoiceAvailableCents({
              totalCents: a.total_cents,
              amountPaidCents: a.amount_paid_cents,
              pendingUnreconciledCents: pendingInvoicePayments.get(a.id) || 0,
            });
            const avB = invoiceAvailableCents({
              totalCents: b.total_cents,
              amountPaidCents: b.amount_paid_cents,
              pendingUnreconciledCents: pendingInvoicePayments.get(b.id) || 0,
            });
            return avB - avA;
          })
          .map((invoice) => {
            const pending = pendingInvoicePayments.get(invoice.id) || 0;
            const available = invoiceAvailableCents({
              totalCents: invoice.total_cents,
              amountPaidCents: invoice.amount_paid_cents,
              pendingUnreconciledCents: pending,
            });
            const diff = manualMovement.amount_cents - available;
            const suffix = diff > 0 ? ` · diferença ${formatBrlCents(diff)}` : '';
            return { value: invoice.id, label: `${invoiceLabel(invoice)}${suffix}` };
          })
      : manualEligiblePayables.map((payable) => ({ value: payable.id, label: payableLabel(payable) }))
    : [];

  const manualSelectedInvoice =
    manualMovement?.direction === 'credit' && manualTargetId
      ? invoices.find((invoice) => invoice.id === manualTargetId) || null
      : null;
  const manualSelectedPending = manualSelectedInvoice
    ? pendingInvoicePayments.get(manualSelectedInvoice.id) || 0
    : 0;
  const manualSelectedAvailable = manualSelectedInvoice
    ? invoiceAvailableCents({
        totalCents: manualSelectedInvoice.total_cents,
        amountPaidCents: manualSelectedInvoice.amount_paid_cents,
        pendingUnreconciledCents: manualSelectedPending,
      })
    : 0;
  const manualInterestCents =
    manualMovement && manualSelectedInvoice
      ? interestCentsForCredit({
          invoiceTotalCents: manualSelectedInvoice.total_cents,
          amountPaidCents: manualSelectedInvoice.amount_paid_cents,
          pendingUnreconciledCents: manualSelectedPending,
          creditCents: manualMovement.amount_cents,
        })
      : 0;
  const manualConfirmDisabled =
    !manualTargetId ||
    !manualTargetType ||
    manualSettleMut.isPending ||
    (manualInterestCents > 0 && manualInterestReason.trim().length < 3);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-end gap-2">
          <BillingField label="Conta bancária">
            <FormSelect
              className="mt-1 min-w-[220px]"
              size="sm"
              value={accountId}
              onChange={setAccountId}
              options={[
                { value: '', label: 'Selecione…' },
                ...accounts.filter((a) => a.id).map((a) => ({ value: a.id as string, label: a.name })),
              ]}
            />
          </BillingField>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowImport((v) => !v)}>
          <Upload className="mr-1 h-3.5 w-3.5" /> Importar extrato
        </Button>
      </div>

      {showImport ? (
        <BillingSection title="Importar extrato bancário">
          <div className="flex flex-wrap gap-3 items-end">
            <BillingField label="Formato">
              <FormSelect
                className="mt-1 w-28"
                size="sm"
                value={format}
                onChange={(value) => setFormat(value as BillingBankStatementFormat)}
                options={[
                  { value: 'cora', label: 'Cora CSV' },
                  { value: 'c6', label: 'C6 CSV' },
                  { value: 'csv', label: 'CSV' },
                  { value: 'ofx', label: 'OFX' },
                ]}
              />
            </BillingField>
            <BillingField label="Arquivo" className="min-w-72">
              <FormControl
                type="file"
                accept=".csv,.ofx,.txt"
                className="mt-1 block text-xs file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1 file:text-xs file:font-medium file:text-primary"
                onChange={(e) => void onFile(e.currentTarget.files?.[0] || null)}
              />
              {fileName ? (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {fileLoading
                    ? 'Lendo arquivo...'
                    : fileContent
                      ? `Arquivo carregado: ${fileName} · formato detectado: ${format.toUpperCase()}`
                      : `Selecionado: ${fileName}`}
                </div>
              ) : null}
              {fileError ? <div className="mt-1 text-[11px] text-destructive">{fileError}</div> : null}
            </BillingField>
            <Button
              size="sm"
              onClick={() => importMut.mutate()}
              disabled={!accountId || !fileContent || fileLoading || importMut.isPending}
            >
              Importar
            </Button>
          </div>
          {(!accountId || !fileContent) && !fileLoading ? (
            <p className="text-[11px] text-muted-foreground">
              {!accountId
                ? 'Selecione a conta bancária antes de importar.'
                : 'Selecione um arquivo válido para habilitar a importação.'}
            </p>
          ) : null}
        </BillingSection>
      ) : null}

      <BillingSection title="Filtros de conciliação" desc="Refine os movimentos importados por tipo, período, status ou descrição.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <BillingField label="Tipo">
            <FormSelect
              className="mt-1 w-full"
              size="sm"
              value={directionFilter}
              onChange={(value) => setDirectionFilter(value as typeof directionFilter)}
              options={[
                { value: 'all', label: 'Entradas e saídas' },
                { value: 'credit', label: 'Entradas' },
                { value: 'debit', label: 'Saídas' },
              ]}
            />
          </BillingField>
          <BillingField label="Status">
            <FormSelect
              className="mt-1 w-full"
              size="sm"
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as typeof statusFilter)}
              options={[
                { value: 'all', label: 'Todos' },
                { value: 'open', label: 'Pendentes' },
                { value: 'reconciled', label: 'Conciliados' },
              ]}
            />
          </BillingField>
          <BillingField label="De">
            <FormControl className="mt-1" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </BillingField>
          <BillingField label="Até">
            <FormControl className="mt-1" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </BillingField>
          <BillingField label="Buscar descrição">
            <FormControl
              className="mt-1"
              placeholder="Pix, nome, histórico..."
              value={movementSearch}
              onChange={(e) => setMovementSearch(e.target.value)}
            />
          </BillingField>
        </div>
      </BillingSection>

      <BillingSection title="Pesquisa de baixas pendentes" desc="Use para localizar comissões de líderes/parceiros, APs e recebimentos antes de vincular ao movimento bancário.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[220px_1fr]">
          <BillingField label="Tipo da baixa">
            <FormSelect
              className="mt-1 w-full"
              size="sm"
              value={paymentKindFilter}
              onChange={(value) => setPaymentKindFilter(value as PaymentKindFilter)}
              options={[
                { value: 'all', label: 'Todas' },
                { value: 'receivable', label: 'A receber' },
                { value: 'payable', label: 'A pagar' },
                { value: 'leader_commission', label: 'Comissão líder' },
                { value: 'partner_commission', label: 'Comissão parceiro' },
                { value: 'driver', label: 'Entregador' },
                { value: 'operational', label: 'Despesa operacional' },
                { value: 'coop', label: 'Cooperativa' },
                { value: 'flux', label: 'Flux Farma' },
              ]}
            />
          </BillingField>
          <BillingField label="Buscar baixa">
            <FormControl
              className="mt-1"
              placeholder="Líder, parceiro, descrição, valor, categoria..."
              value={paymentSearch}
              onChange={(e) => setPaymentSearch(e.target.value)}
            />
          </BillingField>
        </div>
      </BillingSection>

      {accountId && debitSuggestions.length > 0 ? (
        <BillingSection
          title="Sugestões para confirmar"
          desc="Saídas do extrato que batem com títulos em A pagar (valor exato + nome). Nenhuma baixa é criada até você confirmar."
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              {debitSuggestions.length} sugestão(ões) · {highConfidenceSuggestions.length} de alta confiança
            </p>
            <Button
              size="sm"
              disabled={!highConfidenceSuggestions.length || confirmSuggestionMut.isPending}
              onClick={() =>
                confirmSuggestionMut.mutate(
                  highConfidenceSuggestions.map((s) => ({ movementId: s.movement_id, payableId: s.payable_id }))
                )
              }
            >
              Confirmar todas as de alta confiança
            </Button>
          </div>
          <div className="space-y-2">
            {debitSuggestions.slice(0, 12).map((s) => (
              <div
                key={`${s.movement_id}-${s.payable_id}`}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-surface-elevated px-3 py-2.5"
              >
                <div className="min-w-0 flex-1 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">
                      {formatBrlCents(s.amount_cents)} · {fmtDate(s.movement_date)}
                    </span>
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                        s.high_confidence
                          ? 'border-success/40 bg-success/10 text-success'
                          : 'border-border bg-background text-muted-foreground'
                      )}
                    >
                      {s.high_confidence ? 'Alta confiança' : `Score ${s.score}`}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    Extrato: {s.movement_description || 'sem descrição'}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-snug text-foreground">
                    Título: {s.payable_beneficiary_name || s.payable_description || 'A pagar'} · venc.{' '}
                    {s.payable_due_date || 'sem venc.'}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    disabled={confirmSuggestionMut.isPending}
                    onClick={() =>
                      confirmSuggestionMut.mutate([{ movementId: s.movement_id, payableId: s.payable_id }])
                    }
                  >
                    Confirmar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const movement = movements.find((m) => m.id === s.movement_id) || null;
                      if (!movement) return;
                      setManualMovement(movement);
                      setManualTargetId(s.payable_id);
                      setManualNotes('');
                      setManualInterestReason('');
                    }}
                  >
                    Trocar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setIgnoredSuggestionIds((prev) =>
                        prev.includes(s.movement_id) ? prev : [...prev, s.movement_id]
                      )
                    }
                  >
                    Ignorar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </BillingSection>
      ) : null}

      <div className="grid gap-4 2xl:grid-cols-[minmax(360px,0.8fr)_minmax(720px,1.2fr)]">
        <div className={billingTableShellClassName}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="text-sm font-semibold">Baixas registradas</div>
            <div className="text-[11px] text-muted-foreground">
              {paymentsPagination.totalItems} registro(s)
            </div>
          </div>
          <div className="border-b border-border px-4 py-2">
            <BillingStatusChips
              value={paymentReconcileFilter}
              onChange={setPaymentReconcileFilter}
              allLabel="Todas"
              options={[
                { id: 'reconciled', label: 'Conciliada' },
                { id: 'pending', label: 'Pendente' },
              ]}
            />
          </div>
          <div>
          <table className="w-full table-fixed text-sm">
            <thead className="text-left text-[10px] uppercase text-subtle-foreground">
              <tr>
                <th className="w-[88px] px-4 py-2">Data</th>
                <th className="px-4 py-2">Vínculo</th>
                <th className="w-[100px] px-4 py-2 text-right">Valor</th>
                <th className="w-[92px] px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {paymentsPagination.pageItems.map((p) => {
                const target = paymentTargetLabel(p);
                return (
                  <tr
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setDetailPaymentId(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setDetailPaymentId(p.id);
                      }
                    }}
                    className={cn(
                      'cursor-pointer border-t border-border/40 hover:bg-muted/40',
                      p.id === targetPaymentId && 'bg-primary/10 ring-1 ring-inset ring-primary/30',
                      p.id === detailPaymentId && 'bg-muted/50'
                    )}
                  >
                    <td className="px-4 py-2 align-top font-mono text-[11px]">{fmtDate(p.paid_at)}</td>
                    <td className="break-words px-4 py-2 align-top text-xs">
                      <div className="font-medium text-foreground">{target.type}</div>
                      <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{target.detail}</div>
                    </td>
                    <td className="px-4 py-2 align-top text-right font-mono">{formatBrlCents(p.amount_cents)}</td>
                    <td className="px-4 py-2 align-top text-[11px]">
                      <PaymentStatusBadge reconciled={p.reconciled} />
                    </td>
                  </tr>
                );
              })}
              {!accountId ? (
                <tr>
                  <td colSpan={4} className="p-4">
                    <BillingEmptyState>Selecione uma conta para ver baixas registradas.</BillingEmptyState>
                  </td>
                </tr>
              ) : null}
              {accountId && !filteredRegisteredPayments.length && !registeredPaymentsQuery.isLoading ? (
                <tr>
                  <td colSpan={4} className="p-4">
                    <BillingEmptyState>Nenhuma baixa registrada com os filtros atuais.</BillingEmptyState>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          </div>
          {paymentsPagination.totalItems > paymentsPagination.pageSize ? (
            <PaginationControls
              className="px-4 pb-3"
              page={paymentsPagination.page}
              pageSize={paymentsPagination.pageSize}
              totalItems={paymentsPagination.totalItems}
              onPageChange={paymentsPagination.setPage}
              itemLabel="baixas"
            />
          ) : null}
        </div>

        <div className={billingTableShellClassName}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="text-sm font-semibold">Movimentos bancários (importados)</div>
            <div className="text-[11px] text-muted-foreground">
              {movementsPagination.totalItems} filtrado(s) ({movements.length} total)
            </div>
          </div>
          <div>
          <table className="w-full table-fixed text-sm">
            <thead className="text-left text-[10px] uppercase text-subtle-foreground">
              <tr>
                <th className="w-[88px] px-3 py-2">Data</th>
                <th className="w-[96px] px-3 py-2">Conta</th>
                <th className="px-4 py-2">Descrição</th>
                <th className="w-[108px] px-3 py-2 text-right">Valor</th>
                <th className="w-[160px] px-3 py-2 text-right">Conciliação</th>
              </tr>
            </thead>
            <tbody>
              {movementsPagination.pageItems.map((m) => {
                const compatiblePendingPayments = compatiblePendingPaymentsForMovement(m);
                return (
                  <tr
                    key={m.id}
                    ref={m.id === targetMovementId ? targetMovementRowRef : undefined}
                    className={cn(
                      'border-t border-border/40',
                      m.reconciled && 'opacity-60',
                      m.id === targetMovementId && 'bg-primary/10 ring-1 ring-inset ring-primary/30'
                    )}
                  >
                    <td className="px-3 py-2 align-top font-mono text-[11px]">{fmtDate(m.movement_date)}</td>
                    <td className="break-words px-3 py-2 align-top text-[11px]">{accountLabel(m.bank_account_id)}</td>
                    <td className="break-words px-4 py-2 align-top text-xs leading-relaxed">{m.description || '—'}</td>
                    <td
                      className={cn(
                        'px-3 py-2 align-top text-right font-mono text-xs',
                        m.direction === 'debit' ? 'text-destructive' : 'text-success'
                      )}
                    >
                      {m.direction === 'debit' ? '-' : '+'}
                      {formatBrlCents(m.amount_cents)}
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      {!m.reconciled ? (
                        <div className="flex flex-col items-stretch gap-1">
                          {compatiblePendingPayments.length ? (
                            <FormSearchCombobox
                              className="w-full"
                              inputSize="sm"
                              minChars={0}
                              value={linkPayment[m.id] || ''}
                              onChange={(value) => setLinkPayment((s) => ({ ...s, [m.id]: value }))}
                              placeholder="Buscar baixa registrada…"
                              emptyLabel="Nenhuma baixa compatível"
                              options={compatiblePendingPayments.map((p) => ({
                                value: p.id,
                                label: paymentOptionLabel(p),
                              }))}
                            />
                          ) : (
                            <div className="rounded-md border border-border bg-background/40 px-2 py-1.5 text-left text-[11px] leading-snug text-muted-foreground">
                              Sem baixa registrada compatível. Use baixa manual.
                            </div>
                          )}
                          <div className="grid grid-cols-[34px_1fr] gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!linkPayment[m.id] || reconcileMut.isPending}
                              onClick={() => reconcileMut.mutate({ movementId: m.id, paymentId: linkPayment[m.id] })}
                            >
                              <CheckCircle2 className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setManualMovement(m);
                                setManualTargetId('');
                                setManualNotes('');
                              }}
                            >
                              Manual
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <span className="text-[11px] text-success">Conciliada</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!accountId ? (
                <tr>
                  <td colSpan={5} className="p-4">
                    <BillingEmptyState>Selecione uma conta para ver movimentos.</BillingEmptyState>
                  </td>
                </tr>
              ) : null}
              {accountId && !movements.length && !movementsQuery.isLoading ? (
                <tr>
                  <td colSpan={5} className="p-4">
                    <BillingEmptyState>Nenhum movimento importado para esta conta.</BillingEmptyState>
                  </td>
                </tr>
              ) : null}
              {accountId && movements.length > 0 && !filteredMovements.length ? (
                <tr>
                  <td colSpan={5} className="p-4">
                    <BillingEmptyState>Nenhum movimento encontrado com os filtros atuais.</BillingEmptyState>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          </div>
          {movementsPagination.totalItems > movementsPagination.pageSize ? (
            <PaginationControls
              className="px-4 pb-3"
              page={movementsPagination.page}
              pageSize={movementsPagination.pageSize}
              totalItems={movementsPagination.totalItems}
              onPageChange={movementsPagination.setPage}
              itemLabel="movimentos"
            />
          ) : null}
        </div>
      </div>
      <Dialog open={Boolean(manualMovement)} onOpenChange={(open) => !open && setManualMovement(null)}>
        {manualMovement ? (
          <BillingDialogContent
            title="Baixa manual do movimento"
            description="Selecione o título correspondente. O sistema registra a baixa e concilia o movimento bancário no mesmo passo."
            footer={
              <>
                <Button variant="outline" onClick={() => setManualMovement(null)} disabled={manualSettleMut.isPending}>
                  Cancelar
                </Button>
                <Button
                  disabled={manualConfirmDisabled}
                  onClick={() =>
                    manualTargetType &&
                    manualSettleMut.mutate({
                      movementId: manualMovement.id,
                      targetId: manualTargetId,
                      targetType: manualTargetType,
                      notes: manualNotes || null,
                      interestReason: manualInterestReason.trim() || undefined,
                      interestCents: manualInterestCents,
                    })
                  }
                >
                  {manualInterestCents > 0 ? 'Lançar juros e conciliar' : 'Confirmar baixa'}
                </Button>
              </>
            }
          >
            <div className="rounded-lg border border-border bg-surface-elevated p-3 text-xs">
              <div className="font-medium">{manualMovement.description || 'Movimento sem descrição'}</div>
              <div className="mt-1 flex flex-wrap gap-3 text-muted-foreground">
                <span>{fmtDate(manualMovement.movement_date)}</span>
                <span>{manualMovement.direction === 'credit' ? 'Entrada' : 'Saída'}</span>
                <span className={manualMovement.direction === 'credit' ? 'text-success' : 'text-destructive'}>
                  {manualMovement.direction === 'credit' ? '+' : '-'}
                  {formatBrlCents(manualMovement.amount_cents)}
                </span>
              </div>
            </div>
            <BillingField label={manualMovement.direction === 'credit' ? 'Fatura em A receber' : 'Título em A pagar'}>
              <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
                {manualMovement.direction === 'credit'
                  ? 'Este movimento foi importado como entrada. Por segurança, ele só pode ser baixado contra faturas em A receber.'
                  : 'Este movimento foi importado como saída. Por segurança, ele só pode ser baixado contra títulos em A pagar aprovados e desbloqueados.'}
              </p>
              <FormSearchCombobox
                className="mt-1 w-full"
                inputSize="sm"
                minChars={0}
                value={manualTargetId}
                onChange={setManualTargetId}
                placeholder="Buscar título por nome, valor ou vencimento…"
                emptyLabel="Nenhum título compatível com este valor"
                options={manualTargetOptions}
                disabled={!manualTargetOptions.length}
              />
              {manualMovement.direction === 'debit' && !manualTargetOptions.length ? (
                <div className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-warning">
                  Nenhum AP compatível com esta saída. Existem {payables.length} título(s) em A pagar carregado(s),{' '}
                  {manualApprovedPayables.length} aprovado(s)/desbloqueado(s), e {manualEligiblePayables.length} com saldo igual ou
                  superior a {formatBrlCents(manualMovement.amount_cents)} após descontar baixas pendentes. Se já existir uma
                  baixa registrada para esse AP, use o vínculo de baixas pendentes no movimento em vez da baixa manual.
                </div>
              ) : null}
              {manualMovement.direction === 'credit' && !manualTargetOptions.length ? (
                <div className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-warning">
                  Nenhuma fatura com saldo compatível com esta entrada (saldo ≤ crédito). Se o crédito for maior que o
                  saldo, selecione a fatura candidata após importar títulos em A receber — ou lance juros no detalhe da
                  fatura antes de conciliar.
                </div>
              ) : null}
              {manualSelectedInvoice && manualInterestCents > 0 ? (
                <div className="mt-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-[11px] leading-relaxed">
                  <div>
                    Crédito {formatBrlCents(manualMovement.amount_cents)} · Saldo fatura{' '}
                    {formatBrlCents(manualSelectedAvailable)} · Diferença (juros){' '}
                    <strong>{formatBrlCents(manualInterestCents)}</strong>
                  </div>
                  <div className="mt-2 text-muted-foreground">
                    A diferença será lançada como receita financeira na fatura antes da baixa e conciliação.
                  </div>
                </div>
              ) : null}
            </BillingField>
            {manualInterestCents > 0 ? (
              <BillingField label="Motivo dos juros (obrigatório)">
                <FormControl
                  className="mt-1"
                  value={manualInterestReason}
                  placeholder="Ex.: diferença de centavos no TED bancário"
                  onChange={(e) => setManualInterestReason(e.target.value)}
                />
              </BillingField>
            ) : null}
            <BillingField label="Observação">
              <FormControl
                className="mt-1"
                value={manualNotes}
                placeholder="Opcional"
                onChange={(e) => setManualNotes(e.target.value)}
              />
            </BillingField>
          </BillingDialogContent>
        ) : null}
      </Dialog>
      <BillingPaymentDetailDrawer
        open={Boolean(detailPaymentId)}
        payment={detailPayment}
        movement={detailPayment ? movementByPaymentId.get(detailPayment.id) || null : null}
        targetLabel={detailPayment ? paymentTargetLabel(detailPayment) : { type: 'Baixa', detail: '' }}
        onClose={() => setDetailPaymentId(null)}
        onGoToMovement={goToMovement}
      />
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
    </div>
  );
}
