'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Percent, RotateCcw, RotateCw, Send } from 'lucide-react';
import {
  dailyLineHasStaleWeeklyPayout,
  dailyLineIsPaidInWeeklySettlement,
} from '@plataforma/billing-engine';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormControl } from '@/components/form/FormControl';
import { BillingDriverFilter } from '@/components/billing/BillingDriverFilter';
import { BillingAcertoOverlaysPanel } from '@/components/billing/BillingAcertoOverlaysPanel';
import {
  addPharmacyManualDiscount,
  addPharmacySettlementExclusion,
  approvePharmacySettlements,
  fetchBillingInvoices,
  fetchBillingPayables,
  fetchBillingSettlements,
  fetchPharmacySettlementExclusions,
  pharmacyBillingFromApi,
  recalculateBillingCycle,
  reopenPharmacySettlements,
  transitionBillingSettlement,
} from '@/lib/billing/billingApi';
import { cadastroPageApi } from '@/lib/cadastro/cadastroPageApi';
import { aggregateSettlementsByPharmacy, buildDriverLines } from '@/lib/billing/billingAcertoAggregate';
import { pharmacyAcertoReopenState } from '@/lib/billing/pharmacyAcertoReopen';
import { writeCycleParam } from '@/lib/billing/billingFilterUrl';
import { formatBrlCents, fmtDate } from '@/lib/billing/billingFormat';
import { billingKpiDetailClassName, billingTableShellClassName } from '@/lib/billing/billingReviveUi';
import { useClientPagination } from '@/lib/billing/billingListUtils';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { useAuth } from '@/store/auth';
import { canManageBillingFinancial } from '@/lib/billing/billingFinancialAuth';
import { BillingBackLink } from '@/components/billing/BillingBackLink';
import { BillingEntityName } from '@/components/billing/BillingEntityName';
import { BillingActionFeedbackDialog, BillingDialogContent, BillingField } from '@/components/billing/BillingPrimitives';
import { apiErrorMessage } from '@/lib/apiErrorMessage';

type Props = {
  cycleId: string;
  pharmacyId: string;
};

const LINE_KIND_LABELS: Record<string, string> = {
  deliveries: 'Entregas',
  minimum_guarantee: 'Garantia mínima',
  daily: 'Diária',
  absence: 'Falta',
  quota: 'Cota',
  advance: 'Adiantamento',
  uniform: 'Uniforme',
  bag: 'Bag/mochila',
  other_discount: 'Outros descontos',
  adjustment: 'Ajuste',
};

export function BillingAcertoGroupDetailPanel({ cycleId, pharmacyId }: Props) {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const user = useAuth((s) => s.user);
  const canManage = canManageBillingFinancial(user?.role, user?.permissions);
  const driverFromUrl = searchParams.get('driver_id') || '';
  const [driverId, setDriverId] = useState(driverFromUrl);

  const backHref = useMemo(() => {
    const params = new URLSearchParams();
    writeCycleParam(params, cycleId);
    const page = searchParams.get('page');
    if (page && Number(page) > 1) params.set('page', page);
    for (const key of ['status', 'pharmacy_id', 'cost_center_id', 'driver_id'] as const) {
      const v = searchParams.get(key);
      if (v) params.set(key, v);
    }
    return `/billing/acertos?${params.toString()}`;
  }, [cycleId, searchParams]);

  useEffect(() => {
    setDriverId((prev) => {
      const next = driverFromUrl || '';
      return prev === next ? prev : next;
    });
  }, [driverFromUrl]);

  const onDriverFilterChange = (id: string) => {
    setDriverId(id);
    const params = new URLSearchParams(searchParams.toString());
    if (id) params.set('driver_id', id);
    else params.delete('driver_id');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountAmount, setDiscountAmount] = useState('');
  const [discountJustification, setDiscountJustification] = useState('');
  const [excludeOpen, setExcludeOpen] = useState(false);
  const [excludeJustification, setExcludeJustification] = useState('');
  const [excludeTarget, setExcludeTarget] = useState<{
    driverId: string;
    driverName: string;
    scope: 'driver' | 'line';
    lineKind?: string;
    lineFingerprint?: string;
    lineId?: string;
    settlementId?: string;
    pharmacyAmount?: number;
    driverAmount?: number;
    label: string;
  } | null>(null);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ title: string; description: string } | null>(null);

  const settlementsQuery = useQuery({
    queryKey: ['billing', 'settlements', cycleId],
    queryFn: () => fetchBillingSettlements({ cycle_id: cycleId }),
    enabled: !!cycleId,
  });

  const exclusionsQuery = useQuery({
    queryKey: ['billing', 'settlement-exclusions', cycleId, pharmacyId],
    queryFn: () => fetchPharmacySettlementExclusions(cycleId, pharmacyId),
    enabled: !!cycleId && !!pharmacyId,
  });

  const pharmacyBillingQuery = useQuery({
    queryKey: ['billing', 'pharmacy-billing', pharmacyId],
    queryFn: async () => {
      const row = await cadastroPageApi.fetchPharmacy(pharmacyId);
      const pharmacy = (row as { pharmacy?: Record<string, unknown> }).pharmacy || (row as Record<string, unknown>);
      return pharmacyBillingFromApi(pharmacy);
    },
    enabled: !!pharmacyId,
  });

  const groupSettlements = useMemo(
    () => (settlementsQuery.data || []).filter((s) => s.pharmacy_id === pharmacyId),
    [settlementsQuery.data, pharmacyId]
  );

  const reopenPreview = useMemo(
    () =>
      pharmacyAcertoReopenState({
        settlements: groupSettlements.map((s) => ({ status: s.status, driver_id: s.driver_id })),
      }),
    [groupSettlements]
  );

  const invoicesQuery = useQuery({
    queryKey: ['billing', 'invoices', cycleId],
    queryFn: () => fetchBillingInvoices({ cycle_id: cycleId }),
    enabled: !!cycleId && reopenPreview.visible,
  });
  const payablesQuery = useQuery({
    queryKey: ['billing', 'payables', cycleId, 'driver'],
    queryFn: () => fetchBillingPayables({ cycle_id: cycleId, beneficiary_type: 'driver' }),
    enabled: !!cycleId && reopenPreview.visible,
  });

  const reopenState = useMemo(
    () =>
      pharmacyAcertoReopenState({
        settlements: groupSettlements.map((s) => ({ status: s.status, driver_id: s.driver_id })),
        invoices: (invoicesQuery.data || [])
          .filter((inv) => inv.pharmacy_id === pharmacyId)
          .map((inv) => ({
            pharmacy_id: inv.pharmacy_id,
            status: inv.status,
            amount_paid_cents: inv.amount_paid_cents,
          })),
        payables: (payablesQuery.data || []).map((p) => ({
          beneficiary_id: p.beneficiary_id,
          origin_type: p.origin_type,
          status: p.status,
          amount_paid_cents: p.amount_paid_cents,
        })),
      }),
    [groupSettlements, invoicesQuery.data, payablesQuery.data, pharmacyId]
  );

  const aggregate = useMemo(
    () => aggregateSettlementsByPharmacy(groupSettlements)[0] || null,
    [groupSettlements]
  );

  const lines = useMemo(() => {
    const all = buildDriverLines(groupSettlements);
    if (!driverId) return all;
    return all.filter((l) => l.driverId === driverId);
  }, [groupSettlements, driverId]);
  const linesPagination = useClientPagination(lines);
  const detailLines = useMemo(
    () =>
      groupSettlements
        .filter((settlement) => !driverId || settlement.driver_id === driverId)
        .flatMap((settlement) =>
        (settlement.billing_settlement_lines || []).map((line) => {
          const meta =
            line.metadata && typeof line.metadata === 'object'
              ? (line.metadata as Record<string, unknown>)
              : null;
          const isDaily = line.kind === 'daily';
          const excludedDriver = Number(meta?.settlement_driver_amount_excluded_cents || 0);
          const driverAmount = Number(line.driver_amount_cents || 0);
          const dailyOnThursdayTrack = dailyLineIsPaidInWeeklySettlement(line);
          const dailyOnTuesdayTrack = isDaily && !dailyOnThursdayTrack;
          const fingerprint = `${line.kind}:${String(meta?.allocation_rule || meta?.contracted_rule || '')}`;
          return {
            id: line.id,
            settlementId: settlement.id,
            driverId: settlement.driver_id,
            driverName: settlement.drivers?.name || '—',
            kind: line.kind,
            description: line.description,
            pharmacyAmount: Number(line.pharmacy_amount_cents || 0),
            driverAmount,
            excludedDriver,
            dailyOnTuesdayTrack,
            dailyOnThursdayTrack,
            staleDailyInWeekly: dailyLineHasStaleWeeklyPayout(line),
            isManualDiscount:
              meta?.source === 'manual_discount' ||
              meta?.scope === 'pharmacy_group' ||
              (line.kind === 'adjustment' && Boolean(meta?.justification)),
            justification: meta?.justification ? String(meta.justification) : null,
            excluded: Boolean(meta?.billing_exclusion),
            exclusionJustification: meta?.billing_exclusion_justification
              ? String(meta.billing_exclusion_justification)
              : null,
            fingerprint,
            excludable: ['deliveries', 'minimum_guarantee', 'daily'].includes(line.kind),
          };
        })
      ),
    [groupSettlements, driverId]
  );
  const staleDailyInWeekly = useMemo(
    () => detailLines.some((l) => l.staleDailyInWeekly),
    [detailLines]
  );
  const detailPagination = useClientPagination(detailLines);

  const showActionError = (err: unknown, fallback: string, title = 'Não foi possível concluir') => {
    setFeedback({ title, description: apiErrorMessage(err, fallback) });
  };

  const recalcMut = useMutation({
    mutationFn: () => recalculateBillingCycle(cycleId, { pharmacyId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing', 'settlements', cycleId] });
      qc.invalidateQueries({ queryKey: ['billing', 'settlement-exclusions', cycleId, pharmacyId] });
    },
    onError: (err) =>
      showActionError(
        err,
        'Não foi possível recalcular. Se o acerto já foi aprovado, use Estornar acerto e tente de novo.',
        'Recálculo bloqueado'
      ),
  });

  const discountMut = useMutation({
    mutationFn: () =>
      addPharmacyManualDiscount(cycleId, pharmacyId, {
        amount_cents: Math.round(Number(discountAmount.replace(',', '.')) * 100),
        justification: discountJustification.trim(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing', 'settlements', cycleId] });
      setDiscountOpen(false);
      setDiscountAmount('');
      setDiscountJustification('');
    },
  });

  const canDiscount = groupSettlements.some((s) => s.status === 'open' || s.status === 'in_review');
  const canExclude = canDiscount;

  const excludeMut = useMutation({
    mutationFn: async () => {
      if (!excludeTarget) throw new Error('Selecione o que excluir.');
      return addPharmacySettlementExclusion(cycleId, pharmacyId, {
        driver_id: excludeTarget.driverId,
        scope: excludeTarget.scope,
        justification: excludeJustification.trim(),
        line_kind: excludeTarget.lineKind,
        line_fingerprint: excludeTarget.lineFingerprint,
        line_id: excludeTarget.lineId,
        settlement_id: excludeTarget.settlementId,
        pharmacy_amount_cents_before: excludeTarget.pharmacyAmount,
        driver_amount_cents_before: excludeTarget.driverAmount,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing', 'settlements', cycleId] });
      qc.invalidateQueries({ queryKey: ['billing', 'settlement-exclusions', cycleId, pharmacyId] });
      setExcludeOpen(false);
      setExcludeJustification('');
      setExcludeTarget(null);
    },
  });
  const pharmacyDiscountTotal = useMemo(
    () =>
      detailLines
        .filter((line) => line.isManualDiscount && line.pharmacyAmount < 0)
        .reduce((sum, line) => sum + Math.abs(line.pharmacyAmount), 0),
    [detailLines]
  );

  const approveMut = useMutation({
    mutationFn: () => approvePharmacySettlements(cycleId, pharmacyId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing', 'settlements', cycleId] }),
    onError: (err) => showActionError(err, 'Não foi possível aprovar o acerto.', 'Falha ao aprovar'),
  });

  const submitMut = useMutation({
    mutationFn: async () => {
      for (const s of groupSettlements.filter((x) => x.status === 'open')) {
        await transitionBillingSettlement(s.id, 'submit_review');
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing', 'settlements', cycleId] }),
    onError: (err) => showActionError(err, 'Não foi possível enviar para revisão.', 'Falha ao enviar revisão'),
  });

  const reopenMut = useMutation({
    mutationFn: () => reopenPharmacySettlements(cycleId, pharmacyId),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['billing', 'settlements', cycleId] });
      qc.invalidateQueries({ queryKey: ['billing', 'invoices', cycleId] });
      qc.invalidateQueries({ queryKey: ['billing', 'payables', cycleId] });
      setReopenOpen(false);
      setFeedback({
        title: 'Acerto estornado',
        description: result.recalc_warning
          ? `${result.updated} acerto(s) voltaram para aberto. ${result.recalc_warning} Recalcule antes de aprovar.`
          : `${result.updated} acerto(s) voltaram para aberto e foram recalculados com o cadastro atual (split, MG, diária). Revise os valores e aprove de novo.`,
      });
    },
    onError: (err) => {
      setReopenOpen(false);
      showActionError(
        err,
        'Não foi possível estornar o acerto. Se houver fatura paga ou AP com baixa, o estorno fica bloqueado.',
        'Estorno bloqueado'
      );
    },
  });

  if (settlementsQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">Carregando acerto…</div>;
  }

  if (settlementsQuery.isError) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-destructive">Falha ao carregar o acerto deste ciclo.</p>
        <p className="text-muted-foreground">
          {(settlementsQuery.error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
            'Verifique a API local e recarregue a página.'}
        </p>
        <BillingBackLink href={backHref} label="Voltar para acertos" />
      </div>
    );
  }

  if (!aggregate) {
    return (
      <div className="text-sm text-muted-foreground">
        Acerto não encontrado para este ciclo e farmácia.{' '}
        <Link href={backHref} className="text-primary hover:underline">
          Voltar
        </Link>
      </div>
    );
  }

  const canSubmit = groupSettlements.some((s) => s.status === 'open');
  const canApprove = groupSettlements.some((s) => s.status === 'open' || s.status === 'in_review');

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <BillingBackLink href={backHref} label="Voltar para acertos" />
        <div className="flex flex-wrap justify-end gap-2">
          {canManage && canDiscount ? (
            <Button size="sm" variant="outline" onClick={() => setDiscountOpen(true)}>
              <Percent className="mr-1 h-3.5 w-3.5" /> Desconto na fatura
            </Button>
          ) : null}
          {canManage ? (
            <Button size="sm" variant="outline" onClick={() => recalcMut.mutate()} disabled={recalcMut.isPending}>
              <RotateCw className="mr-1 h-3.5 w-3.5" /> Recalcular
            </Button>
          ) : null}
          {canManage && reopenState.visible ? (
            <Button
              size="sm"
              variant="outline"
              title={reopenState.disabledReason || 'Estorna todos os acertos aprovados desta farmácia no ciclo'}
              onClick={() => setReopenOpen(true)}
              disabled={!reopenState.enabled || reopenMut.isPending}
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Estornar acerto
            </Button>
          ) : null}
          {canManage && canSubmit ? (
            <Button size="sm" variant="outline" onClick={() => submitMut.mutate()} disabled={submitMut.isPending}>
              <Send className="mr-1 h-3.5 w-3.5" /> Enviar revisão
            </Button>
          ) : null}
          {canManage && canApprove ? (
            <Button size="sm" onClick={() => approveMut.mutate()} disabled={approveMut.isPending}>
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Aprovar acerto
            </Button>
          ) : null}
        </div>
      </div>

      {reopenState.visible && reopenState.disabledReason ? (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <p className="font-medium text-warning">Estorno indisponível</p>
          <p className="mt-1 text-xs text-muted-foreground">{reopenState.disabledReason}</p>
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className={billingKpiDetailClassName}>
          <div className="text-xs text-muted-foreground">Farmácia</div>
          <div className="font-medium">
            <BillingEntityName name={aggregate.pharmacyName} />
          </div>
          <div className="text-xs text-muted-foreground">{aggregate.costCenterName || '—'}</div>
        </div>
        <div className={billingKpiDetailClassName}>
          <div className="text-xs text-muted-foreground">Ciclo</div>
          <div className="font-mono text-sm">
            {fmtDate(aggregate.apuracaoStart)} → {fmtDate(aggregate.apuracaoEnd)}
          </div>
        </div>
        <div className={billingKpiDetailClassName}>
          <div className="text-xs text-muted-foreground">PIX acerto (quinta)</div>
          <div className="font-mono text-base font-semibold">{formatBrlCents(aggregate.totalRepasse)}</div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            Operacional (DRE): {formatBrlCents(aggregate.totalRepasseOperacional)}
            {aggregate.totalDeducaoCapital > 0 ? (
              <> · Capital coop.: −{formatBrlCents(aggregate.totalDeducaoCapital)}</>
            ) : null}
          </div>
          {aggregate.totalDiariasQuinta > 0 ? (
            <div className="mt-1 text-[10px] text-muted-foreground">
              Inclui diária-base de escala: {formatBrlCents(aggregate.totalDiariasQuinta)}
            </div>
          ) : null}
          {aggregate.totalDiariasTerca > 0 ? (
            <div className="mt-1 text-[10px] text-muted-foreground">
              Diárias do Financeiro → PIX terça: {formatBrlCents(aggregate.totalDiariasTerca)} (fora deste total)
            </div>
          ) : null}
        </div>
        <div className={billingKpiDetailClassName}>
          <div className="text-xs text-muted-foreground">Faturado à farmácia</div>
          <div className="font-mono text-base font-semibold text-success">{formatBrlCents(aggregate.totalFaturado)}</div>
          {pharmacyDiscountTotal > 0 ? (
            <div className="mt-1 text-[10px] text-muted-foreground">
              Descontos manuais: −{formatBrlCents(pharmacyDiscountTotal)}
            </div>
          ) : null}
        </div>
      </div>

      {(exclusionsQuery.data || []).length ? (
        <div className="mb-4 rounded-md border border-border bg-muted/30 px-4 py-3 text-sm">
          <p className="font-medium">Exclusões preservadas no recálculo</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {(exclusionsQuery.data || []).map((row) => (
              <li key={`${row.driverId}:${row.scope}:${row.lineKind || ''}:${row.lineFingerprint || ''}`}>
                {row.scope === 'driver' ? 'Entregador inteiro' : `Linha ${LINE_KIND_LABELS[row.lineKind || ''] || row.lineKind}`}
                {' · '}
                {row.justification}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <BillingAcertoOverlaysPanel
        cycleId={cycleId}
        pharmacyId={pharmacyId}
        drivers={groupSettlements.map((s) => ({
          id: s.driver_id,
          name: s.drivers?.name || s.driver_id,
        }))}
        defaultDayBaseCents={pharmacyBillingQuery.data?.driver_day_base_cents ?? 7000}
        dayBaseEnabled={pharmacyBillingQuery.data?.driver_day_base_enabled === true}
        canManage={canManage}
      />

      {staleDailyInWeekly ? (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <p className="font-medium text-warning">Recalcule antes de aprovar</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Este acerto foi calculado com regra antiga. Clique em <strong>Recalcular</strong> antes de aprovar. As
            diárias já saem na terça-feira (A pagar → Diárias); o PIX da quinta não deve repetir esse valor.
          </p>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <BillingDriverFilter
          value={driverId}
          onChange={onDriverFilterChange}
          pharmacyId={pharmacyId}
          requirePharmacy
          className="min-w-[220px]"
        />
      </div>

      <div className={billingTableShellClassName}>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
            <tr>
              <th className="px-4 py-3">Entregador</th>
              <th className="px-4 py-3 text-center">Entregas</th>
              <th className="px-4 py-3 text-right">Base do repasse</th>
              <th className="px-4 py-3 text-right">Diárias</th>
              <th className="px-4 py-3 text-right">Adic.</th>
              <th className="px-4 py-3 text-right">Faltas</th>
              <th className="px-4 py-3 text-right">Capital coop.</th>
              <th className="px-4 py-3 text-right">Rateio</th>
              <th className="px-4 py-3 text-right">Rep. oper.</th>
              <th className="px-4 py-3 text-right">PIX quinta</th>
              <th className="px-4 py-3 text-right">A faturar</th>
              {canExclude ? <th className="px-4 py-3 text-right">Acerto</th> : null}
            </tr>
          </thead>
          <tbody>
            {linesPagination.pageItems.map((l) => (
              <tr key={l.settlementId} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-3 font-medium">
                  <BillingEntityName name={l.driverName} />
                  {!l.linkedToPharmacy ? (
                    <div className="mt-0.5 inline-block rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">
                      Sem vínculo nesta loja
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-center font-mono">{l.deliveryCount}</td>
                <td className="px-4 py-3 text-right font-mono">
                  {formatBrlCents(l.baseRepasse)}
                  {l.minimoAplicado ? <div className="text-[10px] text-warning">MG repasse</div> : null}
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  {formatBrlCents(l.diariasTerca + l.diariasQuinta)}
                  {l.diariasQuinta > 0 ? (
                    <div className="text-[10px] text-muted-foreground">
                      {formatBrlCents(l.diariasQuinta)} no PIX quinta
                    </div>
                  ) : null}
                  {l.diariasTerca > 0 ? (
                    <div className="text-[10px] text-muted-foreground">
                      {formatBrlCents(l.diariasTerca)} no PIX terça
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-right font-mono">{formatBrlCents(l.adicionais)}</td>
                <td className="px-4 py-3 text-right font-mono">{formatBrlCents(l.faltas)}</td>
                <td className="px-4 py-3 text-right font-mono">{formatBrlCents(l.capitalCoop)}</td>
                <td className="px-4 py-3 text-right font-mono">{formatBrlCents(l.rateio)}</td>
                <td className="px-4 py-3 text-right font-mono">{formatBrlCents(l.repasseOperacional)}</td>
                <td className="px-4 py-3 text-right font-mono font-semibold">{formatBrlCents(l.valorEntregador)}</td>
                <td className="px-4 py-3 text-right font-mono font-semibold text-success">
                  {formatBrlCents(l.valorFaturadoFarmacia)}
                  {l.minimoAplicado ? <div className="text-[10px] text-warning">MG farmácia</div> : null}
                </td>
                {canExclude ? (
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="xs"
                      variant="ghost"
                      title="Excluir este entregador do acerto desta farmácia"
                      onClick={() => {
                        setExcludeTarget({
                          driverId: l.driverId,
                          driverName: l.driverName,
                          scope: 'driver',
                          settlementId: l.settlementId,
                          pharmacyAmount: l.valorFaturadoFarmacia,
                          driverAmount: l.valorEntregador,
                          label: `Entregador ${l.driverName}`,
                        });
                        setExcludeOpen(true);
                      }}
                    >
                      <Ban className="h-3.5 w-3.5" /> Excluir
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {linesPagination.totalItems > linesPagination.pageSize ? (
          <PaginationControls
            className="px-4 pb-3"
            page={linesPagination.page}
            pageSize={linesPagination.pageSize}
            totalItems={linesPagination.totalItems}
            onPageChange={linesPagination.setPage}
            itemLabel="entregadores"
          />
        ) : null}
      </div>

      <div className={`mt-4 ${billingTableShellClassName}`}>
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Detalhamento do acerto</h3>
          <p className="text-xs text-muted-foreground">
            Faltas entram no DRE da farmácia. Cota, adiantamento, uniforme e bag são capital cooperativo (fora da margem).
            Toda linha de diária cobra a farmácia aqui; o repasse ao entregador segue a trilha marcada em cada linha —
            a diária-base de escala sai no acerto (quinta) e a diária do Financeiro sai na trilha Diárias (terça).
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
            <tr>
              <th className="px-4 py-3">Entregador</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Descrição</th>
              <th className="px-4 py-3 text-right">Farmácia</th>
              <th className="px-4 py-3 text-right">Entregador (acerto)</th>
              {canExclude ? <th className="px-4 py-3 text-right">Acerto</th> : null}
            </tr>
          </thead>
          <tbody>
            {detailPagination.pageItems.map((line) => (
              <tr key={line.id} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2.5 font-medium">
                  <BillingEntityName name={line.driverName} />
                </td>
                <td className="px-4 py-2.5 text-xs">
                  <div>{LINE_KIND_LABELS[line.kind] || line.kind}</div>
                  {line.dailyOnTuesdayTrack ? (
                    <div className="mt-0.5 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      Diária → PIX terça
                    </div>
                  ) : null}
                  {line.dailyOnThursdayTrack ? (
                    <div className="mt-0.5 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      Diária → PIX quinta
                    </div>
                  ) : null}
                  {line.kind !== 'daily' && line.kind !== 'absence' && line.driverAmount !== 0 ? (
                    <div className="mt-0.5 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      Acerto → PIX quinta
                    </div>
                  ) : null}
                  {line.staleDailyInWeekly ? (
                    <div className="mt-0.5 text-[10px] text-warning">diária ainda no PIX da quinta — recalcular</div>
                  ) : null}
                  {line.isManualDiscount ? (
                    <div className="mt-0.5 text-[10px] text-muted-foreground">desconto manual (fatura)</div>
                  ) : null}
                  {line.excluded ? (
                    <div className="mt-0.5 inline-block rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">
                      Excluída do acerto
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {line.description || '—'}
                  {line.justification ? (
                    <div className="mt-0.5 text-[10px] text-muted-foreground">Justificativa: {line.justification}</div>
                  ) : null}
                  {line.exclusionJustification ? (
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      Exclusão: {line.exclusionJustification}
                    </div>
                  ) : null}
                </td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{formatBrlCents(line.pharmacyAmount)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">
                  {line.dailyOnTuesdayTrack && !line.staleDailyInWeekly ? (
                    <>
                      {formatBrlCents(0)}
                      {line.excludedDriver > 0 ? (
                        <div className="text-[10px] text-muted-foreground">
                          ref. {formatBrlCents(line.excludedDriver)} na terça
                        </div>
                      ) : null}
                    </>
                  ) : (
                    formatBrlCents(line.driverAmount)
                  )}
                </td>
                {canExclude ? (
                  <td className="px-4 py-2.5 text-right">
                    {line.excludable && !line.excluded ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        title="Excluir esta linha do acerto"
                        onClick={() => {
                          setExcludeTarget({
                            driverId: line.driverId,
                            driverName: line.driverName,
                            scope: 'line',
                            lineKind: line.kind,
                            lineFingerprint: line.fingerprint,
                            lineId: line.id,
                            settlementId: line.settlementId,
                            pharmacyAmount: line.pharmacyAmount,
                            driverAmount: line.driverAmount,
                            label: `${LINE_KIND_LABELS[line.kind] || line.kind} · ${line.driverName}`,
                          });
                          setExcludeOpen(true);
                        }}
                      >
                        <Ban className="h-3.5 w-3.5" /> Excluir
                      </Button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
            {!detailLines.length ? (
              <tr>
                <td
                  colSpan={canExclude ? 6 : 5}
                  className="px-4 py-6 text-center text-xs text-muted-foreground"
                >
                  Nenhuma linha detalhada encontrada para este acerto.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {detailPagination.totalItems > detailPagination.pageSize ? (
          <PaginationControls
            className="px-4 pb-3"
            page={detailPagination.page}
            pageSize={detailPagination.pageSize}
            totalItems={detailPagination.totalItems}
            onPageChange={detailPagination.setPage}
            itemLabel="lançamentos"
          />
        ) : null}
      </div>

      <Dialog open={discountOpen} onOpenChange={setDiscountOpen}>
        <BillingDialogContent
          title="Desconto na fatura da farmácia"
          description={
            aggregate
              ? `Abate o valor do faturamento de ${aggregate.pharmacyName} neste ciclo. O repasse aos entregadores não é alterado. A justificativa é obrigatória.`
              : 'Desconto manual no faturamento da farmácia.'
          }
          footer={
            <Button
              className="w-full"
              onClick={() => discountMut.mutate()}
              disabled={
                !discountJustification.trim() ||
                !discountAmount ||
                Number(discountAmount.replace(',', '.')) <= 0 ||
                discountMut.isPending
              }
            >
              {discountMut.isPending ? 'Aplicando…' : 'Aplicar desconto na fatura'}
            </Button>
          }
        >
          <div className="space-y-3">
            <BillingField label="Valor (R$)">
              <FormControl
                type="number"
                min="0"
                step="0.01"
                value={discountAmount}
                onChange={(e) => setDiscountAmount(e.target.value)}
                className="mt-1 w-full"
              />
            </BillingField>
            <BillingField label="Justificativa (obrigatória)">
              <FormControl
                value={discountJustification}
                onChange={(e) => setDiscountJustification(e.target.value)}
                className="mt-1 w-full"
                placeholder="Ex.: acordo comercial, correção operacional…"
              />
            </BillingField>
            {discountMut.isError ? (
              <p className="text-xs text-destructive">
                {apiErrorMessage(discountMut.error, 'Não foi possível aplicar o desconto.')}
              </p>
            ) : null}
          </div>
        </BillingDialogContent>
      </Dialog>

      <Dialog open={excludeOpen} onOpenChange={(open) => {
        setExcludeOpen(open);
        if (!open) {
          setExcludeTarget(null);
          setExcludeJustification('');
        }
      }}>
        <BillingDialogContent
          title={excludeTarget?.scope === 'driver' ? 'Excluir entregador do acerto' : 'Excluir linha do acerto'}
          description={
            excludeTarget
              ? `${excludeTarget.label}. A exclusão fica no acerto desta farmácia neste ciclo e o Recalcular não a desfaz. Justificativa obrigatória.`
              : 'Exclui do faturamento, sem apagar o lançamento do Financeiro.'
          }
          footer={
            <Button
              className="w-full"
              onClick={() => excludeMut.mutate()}
              disabled={!excludeJustification.trim() || excludeJustification.trim().length < 3 || excludeMut.isPending}
            >
              {excludeMut.isPending ? 'Excluindo…' : 'Excluir do acerto'}
            </Button>
          }
        >
          <div className="space-y-3">
            <BillingField label="Justificativa (obrigatória)">
              <FormControl
                value={excludeJustification}
                onChange={(e) => setExcludeJustification(e.target.value)}
                className="mt-1 w-full"
                placeholder="Ex.: vínculo residual de teste, cobertura pontual, conferência operacional…"
              />
            </BillingField>
            {excludeMut.isError ? (
              <p className="text-xs text-destructive">
                {apiErrorMessage(excludeMut.error, 'Não foi possível excluir do acerto.')}
              </p>
            ) : null}
          </div>
        </BillingDialogContent>
      </Dialog>

      <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
        <BillingDialogContent
          title="Estornar acerto desta farmácia?"
          description={
            aggregate
              ? `Reabre os ${reopenState.reopenableCount} acerto(s) aprovados/em revisão de ${aggregate.pharmacyName} neste ciclo.`
              : 'Reabre os acertos aprovados desta farmácia no ciclo.'
          }
          footer={
            <div className="flex w-full gap-2">
              <Button className="flex-1" variant="outline" onClick={() => setReopenOpen(false)} disabled={reopenMut.isPending}>
                Cancelar
              </Button>
              <Button className="flex-1" onClick={() => reopenMut.mutate()} disabled={reopenMut.isPending || !reopenState.enabled}>
                {reopenMut.isPending ? 'Estornando…' : 'Estornar acerto'}
              </Button>
            </div>
          }
        >
          <ul className="list-disc space-y-1.5 pl-4 text-xs text-muted-foreground">
            <li>Os acertos voltam para aberto (todos os entregadores desta farmácia).</li>
            <li>Faturas rascunho/sem baixa desta farmácia serão apagadas.</li>
            <li>Títulos em A pagar sem baixa serão regenerados.</li>
            <li>O sistema recalcula automaticamente com o cadastro atual (split, MG, diária). Faturas nascem na reaprovação.</li>
          </ul>
          {reopenState.disabledReason ? (
            <p className="text-xs text-destructive">{reopenState.disabledReason}</p>
          ) : null}
          {reopenMut.isError ? (
            <p className="text-xs text-destructive">
              {apiErrorMessage(reopenMut.error, 'Não foi possível estornar o acerto.')}
            </p>
          ) : null}
        </BillingDialogContent>
      </Dialog>

      <Dialog open={Boolean(feedback)} onOpenChange={(open) => !open && setFeedback(null)}>
        {feedback ? (
          <BillingActionFeedbackDialog
            open={Boolean(feedback)}
            onOpenChange={(open) => !open && setFeedback(null)}
            title={feedback.title}
            description={feedback.description}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
