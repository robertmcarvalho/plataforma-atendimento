'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parse, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  DollarSign,
  FileSpreadsheet,
  Info,
  Link2,
  MessageSquare,
  Settings2,
  Upload,
  X,
} from 'lucide-react';
import { FormControl, formTextareaClassName } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { useAuth } from '@/store/auth';
import { formatBRL } from '@/lib/brFormat';
import { formatDateBr, formatDateTimeBr } from '@/lib/datetimeBr';
import {
  RULE_KIND_LABELS,
  formatBrDate,
  type DiscountRule,
  type DiscountRuleKind,
} from '@/lib/financialCycle';
import { reviveOutlineButtonClassName, reviveTableHeadRowClassName } from '@/lib/reviveSurfaces';
import { buildDefaultRule, WEEK_DAYS } from '@/lib/financial/financialDiscountRules';
import { useEntryTypes, useTypeLabels } from '@/lib/financial/entryTypesContext';
import {
  absenceDispositionLabel,
  coverageRoleLabel,
  entryStatusLabel,
  frequencyLabel,
  inferEntryOrigin,
  occurrenceKindLabel,
  userRoleLabel,
} from '@/lib/financial/financialLabels';
import {
  buildCoverageMaps,
  coverageListHint,
  resolveCoverageAbsence,
  resolveCoverageDailies,
  resolveLinkedEntryId,
} from '@/lib/financial/financialCoverage';
import {
  formatRequestAtSaoPaulo,
  installmentStatusLabel,
  installmentsOnReferenceDate,
  isOpenInstallmentStatus,
} from '@/lib/financial/financialInstallments';
import type { ApiEntry, DriverOption, PharmacyOption } from '@/lib/financial/types';
import { hasResourcePermission } from '@/lib/permissions';
export function ApprovalDrawer({
  id,
  fallbackEntry,
  discountRules,
  canApprove,
  onClose,
  onRefresh,
  onOpenEntry,
  coverageMaps,
}: {
  id: string;
  fallbackEntry: ApiEntry | null;
  discountRules: Record<string, DiscountRule>;
  canApprove: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onOpenEntry?: (entryId: string) => void;
  coverageMaps: ReturnType<typeof buildCoverageMaps>;
}) {
  const labels = useTypeLabels();
  const queryClient = useQueryClient();
  const user = useAuth((s) => s.user);
  const role = user?.role || '';
  const canEdit =
    ['admin', 'financial', 'supervisor'].includes(role) ||
    hasResourcePermission(user?.permissions, 'financial', 'manage');
  const canCancelAdvance =
    ['admin', 'financial', 'supervisor'].includes(role) ||
    hasResourcePermission(user?.permissions, 'financial', 'manage');
  const canDecideAbsence = canEdit;
  const [editing, setEditing] = useState(false);
  const [discountAmountInput, setDiscountAmountInput] = useState('');
  const [dispositionNotes, setDispositionNotes] = useState('');
  const [dailyBillingForm, setDailyBillingForm] = useState({
    treatment: 'pending_audit' as 'charge_pharmacy' | 'absorb_operation' | 'pending_audit',
    pharmacyChargeAmount: '',
    notes: '',
  });
  const [editForm, setEditForm] = useState({
    pharmacy_id: '',
    driver_id: '',
    total_amount: '',
    installments_count: '1',
    notes: '',
  });

  const { data: entry, isLoading, error } = useQuery<ApiEntry>({
    queryKey: ['financial-entry-detail', id],
    queryFn: () => api.get(`/api/financial/entries/${id}`).then(r => r.data),
    enabled: Boolean(id),
  });
  const activeEntry = entry || fallbackEntry;

  useEffect(() => {
    if (!activeEntry) return;
    setEditing(false);
    setEditForm({
      pharmacy_id: activeEntry.pharmacies?.id || '',
      driver_id: activeEntry.drivers?.id || '',
      total_amount: String(activeEntry.total_amount ?? ''),
      installments_count: String(activeEntry.installments_count ?? 1),
      notes: activeEntry.notes || '',
    });
    const proposed =
      activeEntry.proposed_discount_amount ?? activeEntry.total_amount ?? 0;
    setDiscountAmountInput(String(proposed));
    setDispositionNotes('');
    setDailyBillingForm({
      treatment: activeEntry.daily_billing_treatment || 'pending_audit',
      pharmacyChargeAmount:
        activeEntry.daily_pharmacy_charge_amount != null
          ? String(activeEntry.daily_pharmacy_charge_amount)
          : String(activeEntry.total_amount ?? ''),
      notes: activeEntry.daily_billing_notes || '',
    });
  }, [activeEntry?.id, activeEntry?.total_amount, activeEntry?.notes, activeEntry?.proposed_discount_amount]);

  const approveMutation = useMutation({
    mutationFn: () => api.patch(`/api/financial/entries/${id}/approve`),
    onSuccess: () => {
      onRefresh();
      onClose();
    }
  });

  const rejectMutation = useMutation({
    mutationFn: (reason: string) => api.patch(`/api/financial/entries/${id}/reject`, { rejection_reason: reason }),
    onSuccess: () => {
      onRefresh();
      onClose();
    }
  });

  const payInstallmentMutation = useMutation({
    mutationFn: (installmentId: string) => api.patch(`/api/financial/installments/${installmentId}/pay`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['financial-entry-detail', id] });
      onRefresh();
    },
  });

  const saveEditMutation = useMutation({
    mutationFn: () =>
      api.patch(`/api/financial/entries/${id}`, {
        pharmacy_id: editForm.pharmacy_id || undefined,
        driver_id: editForm.driver_id || undefined,
        total_amount: parseFloat(editForm.total_amount),
        installments_count: parseInt(editForm.installments_count, 10),
        notes: editForm.notes || null,
      }),
    onSuccess: () => {
      setEditing(false);
      onRefresh();
    },
  });

  const dispositionMutation = useMutation({
    mutationFn: (payload: { action: 'excused' | 'discounted'; discount_amount?: number; notes?: string }) =>
      api.patch(`/api/financial/entries/${id}/disposition`, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['financial-entry-detail', id] });
      onRefresh();
    },
  });

  const dailyBillingMutation = useMutation({
    mutationFn: () =>
      api.patch(`/api/financial/entries/${id}/daily-billing`, {
        treatment: dailyBillingForm.treatment,
        pharmacy_charge_amount:
          dailyBillingForm.treatment === 'charge_pharmacy'
            ? Number(dailyBillingForm.pharmacyChargeAmount || 0)
            : null,
        notes: dailyBillingForm.notes.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['financial-entry-detail', id] });
      onRefresh();
    },
  });

  const cancelAdvanceMutation = useMutation({
    mutationFn: (reason: string) => api.post(`/api/financial/entries/${id}/cancel`, { reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['financial-entry-detail', id] });
      onRefresh();
      onClose();
    },
  });

  const handleOpenLinked = (entryId: string | null | undefined) => {
    if (!activeEntry) return;
    const targetId = entryId || activeEntry.coverage_of_entry_id || null;
    if (!targetId) return;
    onOpenEntry?.(targetId);
  };

  if (isLoading) {
    return (
      <div className="fixed inset-y-0 right-0 z-50 w-[450px] border-l border-border bg-card shadow-2xl animate-in slide-in-from-right duration-300">
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Carregando lançamento...</div>
      </div>
    );
  }

  if (error && !fallbackEntry) {
    return (
      <div className="fixed inset-y-0 right-0 z-50 w-[450px] border-l border-border bg-card shadow-2xl animate-in slide-in-from-right duration-300">
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-sm text-muted-foreground">
          <div className="rounded-full bg-destructive/10 p-3 text-destructive">Erro ao carregar registro</div>
          <div>{error instanceof Error ? error.message : 'Não foi possível abrir o lançamento.'}</div>
          <button type="button" onClick={onClose} className={reviveOutlineButtonClassName}>Fechar</button>
        </div>
      </div>
    );
  }

  if (!activeEntry) {
    return (
      <div className="fixed inset-y-0 right-0 z-50 w-[450px] border-l border-border bg-card shadow-2xl animate-in slide-in-from-right duration-300">
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-sm text-muted-foreground">
          <div className="rounded-full bg-destructive/10 p-3 text-destructive">Lançamento não disponível</div>
          <div>Não foi possível recuperar os dados do lançamento.</div>
          <button type="button" onClick={onClose} className={reviveOutlineButtonClassName}>Fechar</button>
        </div>
      </div>
    );
  }

  const warningMessage = error ? 'Detalhes avançados não puderam ser carregados. Está usando os dados da lista local.' : null;
  const driverName = activeEntry.drivers?.name || 'Sem motorista';
  const driverInitial = driverName.trim().charAt(0) || '?';
  const installments = activeEntry.financial_installments ?? [];
  const linkedAbsence = resolveCoverageAbsence(activeEntry, coverageMaps);
  const linkedDailies = resolveCoverageDailies(activeEntry, coverageMaps);
  const occurrenceKind = occurrenceKindLabel(activeEntry.occurrence_kind);
  const isDayOffAbsence =
    activeEntry.type === 'absence' && activeEntry.occurrence_kind === 'day_off';
  const isUnexcusedAbsence =
    activeEntry.type === 'absence' && activeEntry.occurrence_kind === 'unexcused';
  const absencePendingDecision =
    isUnexcusedAbsence &&
    (!activeEntry.absence_disposition || activeEntry.absence_disposition === 'pending') &&
    activeEntry.status === 'pending_approval';
  const showOccurrencePanel =
    Boolean(
      activeEntry.occurrence_kind ||
        activeEntry.coverage_of_entry_id ||
        linkedDailies.length ||
        linkedAbsence
    );
  const linkedAbsenceKind = linkedAbsence
    ? occurrenceKindLabel(linkedAbsence.occurrence_kind)
    : null;
  const linkedRoleLabel = coverageRoleLabel(linkedAbsence?.occurrence_kind);
  const linkedAbsenceEntryId = resolveLinkedEntryId(activeEntry, linkedAbsence);
  const dailyEventDate =
    activeEntry.type === 'daily'
      ? activeEntry.event_date || linkedAbsence?.event_date || null
      : null;
  const pharmacyHasAutomaticDaily =
    activeEntry.type === 'daily' && activeEntry.pharmacies?.daily_billing_enabled === true;
  const isAdvanceEntry = activeEntry.type === 'advance';
  const openInstallments = installments.filter((item) => isOpenInstallmentStatus(item.status));
  const canCancelThisAdvance =
    canCancelAdvance &&
    isAdvanceEntry &&
    ['active', 'partially_cancelled'].includes(activeEntry.status) &&
    openInstallments.length > 0;
  const firstDiscountDate = installments[0]?.due_date || activeEntry.start_date;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-[min(100vw,480px)] border-l border-border bg-card shadow-2xl animate-in slide-in-from-right duration-300">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h3 className="font-semibold tracking-tight">Análise de Lançamento</h3>
          <button onClick={onClose} className="rounded-full p-1 text-muted-foreground hover:bg-sidebar-accent/60"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
              {driverInitial}
            </div>
            <div>
              <div className="font-medium">{driverName}</div>
              <div className="text-[10px] text-muted-foreground font-mono">{activeEntry.drivers?.cpf || '—'}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface p-4 text-xs">
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">Status</div>
              <div className="font-semibold">{entryStatusLabel(activeEntry.status)}</div>
              {absenceDispositionLabel(activeEntry.absence_disposition) ? (
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {absenceDispositionLabel(activeEntry.absence_disposition)}
                </div>
              ) : null}
            </div>
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">Origem</div>
              <div>{inferEntryOrigin(activeEntry)}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">Tipo</div>
              <div className="text-sm font-bold text-primary">{labels[activeEntry.type] || activeEntry.type}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">Valor Total</div>
              <div className="text-sm font-bold font-mono">{formatBRL(Number(activeEntry.total_amount))}</div>
            </div>
            <div className="col-span-2">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">Farmácia</div>
              <div>{activeEntry.pharmacies?.trade_name || '—'}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">Solicitado por</div>
              <div>
                {activeEntry.created_by_user?.name || '—'} ({userRoleLabel(activeEntry.created_by_user?.role)})
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">Abertura</div>
              <div>{formatRequestAtSaoPaulo(activeEntry.created_at)}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">Início / frequência</div>
              <div>
                {formatDateBr(activeEntry.start_date)} · {frequencyLabel(activeEntry.frequency)} ·{' '}
                {activeEntry.installments_count} parcela(s)
              </div>
            </div>
            {isAdvanceEntry ? (
                <div>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase">1ª quinta de desconto</div>
                  <div>
                    {formatDateBr(firstDiscountDate)} (
                    {format(new Date(`${firstDiscountDate}T12:00:00.000Z`), 'EEEE', { locale: ptBR })})
                  </div>
                </div>
            ) : null}
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">Auditoria</div>
              <div className="space-y-1">
                {activeEntry.approved_at ? (
                  <div>
                    Aprovado em {formatRequestAtSaoPaulo(activeEntry.approved_at)}
                    {activeEntry.approved_by_user?.name ? ` por ${activeEntry.approved_by_user.name}` : ''}
                  </div>
                ) : null}
                {activeEntry.cancelled_at ? (
                  <div className="text-destructive">
                    Cancelado em {formatRequestAtSaoPaulo(activeEntry.cancelled_at)}
                    {activeEntry.cancelled_by_user?.name ? ` por ${activeEntry.cancelled_by_user.name}` : ''}
                  </div>
                ) : null}
                {activeEntry.cancel_reason ? (
                  <div className="text-destructive">Motivo: {activeEntry.cancel_reason}</div>
                ) : null}
                {activeEntry.rejection_reason ? (
                  <div className="text-destructive">Rejeição: {activeEntry.rejection_reason}</div>
                ) : null}
                {!activeEntry.approved_at && !activeEntry.cancelled_at && !activeEntry.rejection_reason ? (
                  <div>—</div>
                ) : null}
              </div>
            </div>
          </div>

          {warningMessage ? (
            <div className="rounded-xl border border-warning/20 bg-warning/5 p-3 text-sm text-warning">
              {warningMessage}
            </div>
          ) : null}

          {activeEntry.notes ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase">
                <MessageSquare className="h-3 w-3" /> Motivo / observações
              </div>
              <div className="rounded-lg bg-muted p-3 text-sm text-foreground leading-relaxed">
                {activeEntry.notes}
              </div>
            </div>
          ) : null}

          {showOccurrencePanel ? (
            <div className="space-y-3 rounded-xl border border-border bg-muted/50 p-4">
              <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase">
                <Link2 className="h-3 w-3" /> Ocorrência de escala
              </div>
              {occurrenceKind ? (
                <div className="text-xs">
                  <span className="text-muted-foreground">Tipo: </span>
                  <span className="font-semibold">{occurrenceKind}</span>
                  {activeEntry.event_date ? (
                    <span className="text-muted-foreground"> · evento {formatBrDate(activeEntry.event_date)}</span>
                  ) : null}
                </div>
              ) : null}
              {linkedAbsenceEntryId && activeEntry.type === 'daily' ? (
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
                  <div className="font-semibold text-foreground">
                    Vinculado ao {linkedAbsenceKind === 'Folga' ? 'folgante' : 'faltante'}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {linkedAbsence?.drivers?.name || 'Entregador'} · {linkedAbsenceKind || 'Ocorrência'}
                    {linkedAbsence?.event_date ? ` · ${formatBrDate(linkedAbsence.event_date)}` : ''}
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Diária de {linkedRoleLabel} — controle operacional para o financeiro.
                  </p>
                  {onOpenEntry ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenLinked(linkedAbsenceEntryId);
                      }}
                      className="mt-2 text-[11px] font-semibold text-primary hover:underline"
                    >
                      Abrir lançamento do {linkedAbsenceKind === 'Folga' ? 'folgante' : 'faltante'}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {linkedDailies.length > 0 && activeEntry.type === 'absence' ? (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-foreground">
                    Diária do {isDayOffAbsence ? 'folguista' : 'diarista'}
                  </div>
                  {linkedDailies.map((daily) => {
                    const dailyId = daily.id;
                    if (!dailyId) return null;
                    return (
                    <div key={dailyId} className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
                      <div className="font-medium">{daily.drivers?.name || 'Cobridor'}</div>
                      <div className="mt-0.5 text-muted-foreground">
                        {formatBRL(Number(daily.total_amount ?? 0))}
                        {daily.event_date ? ` · evento ${formatBrDate(daily.event_date)}` : ''}
                      </div>
                      {onOpenEntry ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenLinked(dailyId);
                          }}
                          className="mt-2 text-[11px] font-semibold text-primary hover:underline"
                        >
                          Abrir diária de cobertura
                        </button>
                      ) : null}
                    </div>
                    );
                  })}
                </div>
              ) : null}
              {isDayOffAbsence ? (
                <p className="text-[11px] text-muted-foreground">
                  Folga informativa — sem desconto ao entregador. Aprove a diária do folguista se houver cobertura.
                </p>
              ) : null}
              {activeEntry.type === 'absence' && linkedDailies.length === 0 && occurrenceKind && !isDayOffAbsence ? (
                <p className="text-[11px] text-muted-foreground">Falta sem cobertura registrada.</p>
              ) : null}
            </div>
          ) : null}

          {absencePendingDecision && canDecideAbsence ? (
            <div className="space-y-3 rounded-xl border border-warning/30 bg-warning/5 p-4">
              <div className="text-xs font-bold text-warning uppercase">Decisão da falta</div>
              <p className="text-[11px] text-muted-foreground">
                Proposta espelhada da diária do diarista
                {activeEntry.proposed_discount_amount != null
                  ? `: ${formatBRL(Number(activeEntry.proposed_discount_amount))}`
                  : ''}
                . Você pode ajustar o valor antes de aplicar o desconto.
              </p>
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Valor do desconto (R$)
                </label>
                <FormControl
                  type="number"
                  min={0}
                  step="0.01"
                  value={discountAmountInput}
                  onChange={(e) => setDiscountAmountInput(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                  Motivo (opcional, ex. exceção ao valor espelhado)
                </label>
                <textarea
                  value={dispositionNotes}
                  onChange={(e) => setDispositionNotes(e.target.value)}
                  rows={2}
                  className={formTextareaClassName}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={dispositionMutation.isPending}
                  onClick={() =>
                    dispositionMutation.mutate({
                      action: 'excused',
                      notes: dispositionNotes.trim() || undefined,
                    })
                  }
                  className={cn(reviveOutlineButtonClassName, 'flex-1 justify-center')}
                >
                  Abonar falta
                </button>
                <Button
                  type="button"
                  size="sm"
                  className="flex-1"
                  disabled={dispositionMutation.isPending || !Number(discountAmountInput)}
                  onClick={() =>
                    dispositionMutation.mutate({
                      action: 'discounted',
                      discount_amount: parseFloat(discountAmountInput),
                      notes: dispositionNotes.trim() || undefined,
                    })
                  }
                >
                  Aplicar desconto
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Abonar zera o desconto do faltante; a diária do diarista continua independente.
              </p>
            </div>
          ) : null}

          {isUnexcusedAbsence && activeEntry.absence_disposition === 'excused' ? (
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              Falta abonada pelo financeiro — sem desconto ao faltante.
            </div>
          ) : null}

          {isUnexcusedAbsence && activeEntry.absence_disposition === 'discounted' ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
              Desconto aplicado: {formatBRL(Number(activeEntry.total_amount))}
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="text-[10px] font-bold text-muted-foreground uppercase">Parcelas</div>
            {installments.length === 0 ? (
              <div className="rounded-lg border border-border bg-muted p-3 text-xs text-muted-foreground">
                Nenhuma parcela cadastrada para este lançamento.
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-left text-[11px]">
                  <thead className={cn(reviveTableHeadRowClassName, 'sticky top-0')}>
                    <tr>
                      <th className="px-2 py-1.5">#</th>
                      <th className="px-2 py-1.5">Venc.</th>
                      <th className="px-2 py-1.5 text-right">Valor</th>
                      <th className="px-2 py-1.5">Status</th>
                      {canEdit ? <th className="px-2 py-1.5 text-right">Baixa</th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {installments.map((row) => (
                      <tr key={row.id}>
                        <td className="px-2 py-1 font-mono">{row.installment_number}</td>
                        <td className="px-2 py-1">{formatDateBr(row.due_date)}</td>
                        <td className="px-2 py-1 text-right font-mono">{formatBRL(Number(row.amount))}</td>
                        <td className="px-2 py-1">
                          {installmentStatusLabel(activeEntry.type, row.status)}
                        </td>
                        {canEdit ? (
                          <td className="px-2 py-1 text-right">
                            {isOpenInstallmentStatus(row.status) ? (
                              <button
                                type="button"
                                onClick={() => payInstallmentMutation.mutate(row.id)}
                                disabled={payInstallmentMutation.isPending}
                                className="rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/15 disabled:opacity-50"
                              >
                                {activeEntry.type === 'daily' ? 'Pago' : 'Descontado'}
                              </button>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">—</span>
                            )}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {activeEntry.type === 'daily' && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
              <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-primary">
                  {activeEntry.coverage_of_entry_id ? `Crédito de diária (${linkedRoleLabel})` : 'Crédito de diária'}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Lançado: {formatRequestAtSaoPaulo(activeEntry.created_at)}
                </p>
                {dailyEventDate ? (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Data da cobertura: {formatBrDate(dailyEventDate)}
                  </p>
                ) : null}
                <p className="text-[11px] text-primary/80 mt-1">
                  Liquidação prevista em{' '}
                  <span className="font-bold underline">
                    {format(
                      new Date(`${installments[0]?.due_date || activeEntry.start_date}T12:00:00.000Z`),
                      'EEEE, dd/MM/yyyy',
                      { locale: ptBR }
                    )}
                  </span>
                  {activeEntry.start_date !== (installments[0]?.due_date || activeEntry.start_date) ? (
                    <span className="block mt-1 text-muted-foreground">
                      Data de início do lançamento: {formatDateBr(activeEntry.start_date)}
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
          )}

          {pharmacyHasAutomaticDaily ? (
            <div className="space-y-2 rounded-lg border border-success/20 bg-success/5 p-4">
              <div className="text-xs font-bold text-success">Diária configurada na ficha da farmácia</div>
              <p className="text-[11px] text-muted-foreground">
                A cobrança desta diária será calculada automaticamente no acerto pela configuração de Faturamento da farmácia.
                Não é necessário decidir manualmente se cobra da farmácia ou absorve pela operação.
              </p>
            </div>
          ) : null}

          {activeEntry.type === 'daily' && canEdit && !pharmacyHasAutomaticDaily ? (
            <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
              <div className="text-xs font-bold text-muted-foreground uppercase">Decisão de faturamento da diária</div>
              <p className="text-[11px] text-muted-foreground">
                Defina se esta diária será cobrada da farmácia, absorvida pela operação ou mantida para auditoria.
              </p>
              <FormSelect
                value={dailyBillingForm.treatment}
                onChange={(v) =>
                  setDailyBillingForm((prev) => ({
                    ...prev,
                    treatment: v as typeof prev.treatment,
                  }))
                }
                options={[
                  { value: 'charge_pharmacy', label: 'Cobrar da farmácia' },
                  { value: 'absorb_operation', label: 'Absorver pela operação' },
                  { value: 'pending_audit', label: 'Pendente de auditoria' },
                ]}
              />
              {dailyBillingForm.treatment === 'charge_pharmacy' ? (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase text-muted-foreground">
                    Valor a cobrar da farmácia (R$)
                  </label>
                  <FormControl
                    type="number"
                    min={0}
                    step="0.01"
                    value={dailyBillingForm.pharmacyChargeAmount}
                    onChange={(e) =>
                      setDailyBillingForm((prev) => ({ ...prev, pharmacyChargeAmount: e.target.value }))
                    }
                    className="font-mono"
                  />
                </div>
              ) : null}
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase text-muted-foreground">Observação</label>
                <textarea
                  value={dailyBillingForm.notes}
                  onChange={(e) => setDailyBillingForm((prev) => ({ ...prev, notes: e.target.value }))}
                  rows={2}
                  className={formTextareaClassName}
                  placeholder="Ex: combinado com a farmácia, custo absorvido pela operação..."
                />
              </div>
              <Button
                type="button"
                size="sm"
                disabled={
                  dailyBillingMutation.isPending ||
                  (dailyBillingForm.treatment === 'charge_pharmacy' && !Number(dailyBillingForm.pharmacyChargeAmount))
                }
                onClick={() => dailyBillingMutation.mutate()}
              >
                Salvar decisão da diária
              </Button>
            </div>
          ) : null}

          {isDayOffAbsence && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
              <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-primary">Folga registrada</div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Registro informativo — sem desconto ao entregador de folga.
                </p>
                {activeEntry.event_date ? (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Evento: {formatBrDate(activeEntry.event_date)}
                  </p>
                ) : null}
              </div>
            </div>
          )}

          {isUnexcusedAbsence && !absencePendingDecision && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 flex items-start gap-3">
              <Info className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-destructive">Falta registrada</div>
                {activeEntry.apuracao_start && activeEntry.apuracao_end ? (
                  <p className="text-[11px] text-destructive/90 mt-1">
                    Ciclo de apuração:{' '}
                    <span className="font-bold underline">
                      {formatBrDate(activeEntry.apuracao_start)} a {formatBrDate(activeEntry.apuracao_end)}
                    </span>
                  </p>
                ) : null}
                <p className="text-[11px] text-destructive/90 mt-1">
                  Pagamento:{' '}
                  <span className="font-bold underline">
                    {format(
                      new Date(`${installments[0]?.due_date || activeEntry.start_date}T12:00:00.000Z`),
                      'EEEE, dd/MM/yyyy',
                      { locale: ptBR }
                    )}
                  </span>
                </p>
                {activeEntry.event_date ? (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Evento: {formatBrDate(activeEntry.event_date)}
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </div>

        {canEdit ? (
          <div className="flex flex-wrap gap-2 border-t border-border bg-surface p-4">
            {!editing ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className={reviveOutlineButtonClassName}
              >
                Editar lançamento
              </button>
            ) : (
              <>
                <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => saveEditMutation.mutate()}
                  disabled={saveEditMutation.isPending}
                >
                  {saveEditMutation.isPending ? 'Salvando…' : 'Salvar alterações'}
                </Button>
              </>
            )}
            {canCancelThisAdvance ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={cancelAdvanceMutation.isPending}
                onClick={() => {
                  const reason = window.prompt(
                    `Cancelar ${openInstallments.length} parcela(s) pendente(s). Informe o motivo (mín. 10 caracteres):`
                  );
                  if (reason && reason.trim().length >= 10) {
                    cancelAdvanceMutation.mutate(reason.trim());
                  } else if (reason) {
                    window.alert('O motivo deve ter pelo menos 10 caracteres.');
                  }
                }}
              >
                {cancelAdvanceMutation.isPending ? 'Cancelando…' : 'Cancelar parcelas pendentes'}
              </Button>
            ) : null}
          </div>
        ) : null}

        {editing && canEdit ? (
          <div className="px-6 pb-4 space-y-3 border-t border-border">
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase text-muted-foreground">Valor total</label>
              <FormControl
                type="number"
                value={editForm.total_amount}
                onChange={(e) => setEditForm((f) => ({ ...f, total_amount: e.target.value }))}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase text-muted-foreground">Nº parcelas</label>
              <FormControl
                type="number"
                min={1}
                value={editForm.installments_count}
                onChange={(e) => setEditForm((f) => ({ ...f, installments_count: e.target.value }))}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase text-muted-foreground">Motivo / observações</label>
              <textarea
                value={editForm.notes}
                onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                rows={3}
                className={formTextareaClassName}
              />
            </div>
          </div>
        ) : null}

        {canApprove && activeEntry.status === 'pending_approval' && activeEntry.type === 'daily' ? (
          <div className="p-4 border-t border-border flex gap-3 bg-muted/50">
            <button
              type="button"
              onClick={() => {
                const reason = window.prompt('Motivo da rejeição:');
                if (reason) rejectMutation.mutate(reason);
              }}
              disabled={rejectMutation.isPending}
              className="flex-1 rounded-md border border-border bg-card py-2 text-xs font-medium text-destructive hover:bg-destructive/5 transition-colors"
            >
              Rejeitar
            </button>
            <Button
              type="button"
              size="sm"
              className="flex-1 shadow-md"
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
            >
              {approveMutation.isPending ? 'Processando...' : 'Aprovar Pagamento'}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}