'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  ExternalLink,
  RefreshCw,
  Truck,
  UserX,
  WalletCards,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { ApprovalDrawer } from '@/components/financial/ApprovalDrawer';
import { BillingBackLink } from '@/components/billing/BillingBackLink';
import { BillingSection } from '@/components/billing/BillingPrimitives';
import {
  decideOffboardingPendingQuota,
  fetchOffboardingConference,
  generateOffboardingPayable,
  recalculateOffboardingPreview,
  syncOffboardingDeliveries,
  updateOffboardingConference,
  type OffboardingConference,
} from '@/lib/billing/billingApi';
import { pharmacyDisplayName } from '@/lib/billing/billingDisplay';
import { billingStatusLabel } from '@/lib/billing/billingLabels';
import { formatBrlCents, fmtDate } from '@/lib/billing/billingFormat';
import {
  billingKpiDetailClassName,
  billingTableCellClassName,
  billingTableHeadClassName,
  billingTableShellClassName,
  billingTabsListClassName,
  billingTabsTriggerClassName,
  billingNoticeClassName,
  deliverySourceBadge,
} from '@/lib/billing/billingReviveUi';
import { signedAmountClassName } from '@/lib/billing/billingListUtils';
import {
  humanizeOffboardingWarning,
  offboardingLineKindLabel,
  offboardingPreviewStatusLabel,
  quotaDecisionLabel,
  quotaLedgerEntryTypeLabel,
} from '@/lib/billing/billingOperationalLabels';
import api from '@/lib/api';
import { useAuth } from '@/store/auth';
import { buildCoverageMaps } from '@/lib/financial/financialCoverage';
import { DEFAULT_DISCOUNT_RULES } from '@/lib/financial/financialDiscountRules';
import { entryStatusLabel, absenceDispositionLabel } from '@/lib/financial/financialLabels';
import { installmentStatusLabel } from '@/lib/financial/financialInstallments';
import type { ApiEntry } from '@/lib/financial/types';
import type { DiscountRule } from '@/lib/financialCycle';
import { hasResourcePermission } from '@/lib/permissions';
import { cn } from '@/lib/utils';

const SETTLEMENT_LINE_KIND_LABELS: Record<string, string> = {
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

const ENTRY_TYPE_LABELS: Record<string, string> = {
  daily: 'Diária',
  absence: 'Falta',
  quota: 'Cota',
  advance: 'Adiantamento',
  uniform: 'Uniforme',
  bag: 'Bag/mochila',
  fine: 'Multa',
  digital_cert: 'Certificado digital',
};

type Props = {
  previewId: string;
};

function ChecklistItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      {ok ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
      ) : (
        <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className={ok ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
    </div>
  );
}

function conferenceToApiEntries(conference: OffboardingConference): ApiEntry[] {
  return conference.financial_entries.map((entry) => ({
    ...entry,
    total_amount: Number(entry.total_amount),
    installments_count: entry.financial_installments?.length || 1,
    financial_installments: entry.financial_installments || [],
  })) as ApiEntry[];
}

export function BillingOffboardingConferenceView({ previewId }: Props) {
  const qc = useQueryClient();
  const user = useAuth((s) => s.user);
  const canApprove =
    ['admin', 'supervisor'].includes(user?.role || '') ||
    hasResourcePermission(user?.permissions, 'financial', 'approve');

  const [tab, setTab] = useState('resumo');
  const [entryDrawerId, setEntryDrawerId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  const conferenceQuery = useQuery({
    queryKey: ['billing', 'offboarding-conference', previewId],
    queryFn: () => fetchOffboardingConference(previewId),
    enabled: !!previewId,
  });

  const discountRulesQuery = useQuery({
    queryKey: ['financial-discount-rules'],
    queryFn: () => api.get('/api/financial/discount-rules').then((r) => r.data as { rules: Record<string, DiscountRule> }),
  });
  const discountRules = { ...DEFAULT_DISCOUNT_RULES, ...(discountRulesQuery.data?.rules || {}) };

  const conference = conferenceQuery.data;
  const preview = conference?.preview;
  const driverId = preview?.driver_id || '';
  const driverName =
    preview?.payload?.driver?.name || preview?.drivers?.name || driverId.slice(0, 8) || 'Entregador';

  const coverageMaps = useMemo(
    () => (conference ? buildCoverageMaps(conferenceToApiEntries(conference)) : buildCoverageMaps([])),
    [conference]
  );

  const selectedEntry = useMemo(() => {
    if (!entryDrawerId || !conference) return null;
    return conferenceToApiEntries(conference).find((e) => e.id === entryDrawerId) || null;
  }, [conference, entryDrawerId]);

  const quotaDiscountHistory = useMemo(() => {
    if (!conference) return [];
    const rows: {
      id: string;
      date: string;
      description: string;
      amountCents: number;
      status: string;
      origin: string;
    }[] = [];
    for (const entry of conference.financial_entries.filter((e) => e.type === 'quota')) {
      for (const inst of entry.financial_installments || []) {
        rows.push({
          id: inst.id,
          date: inst.due_date,
          description: entry.description || 'Desconto de cota cooperativa',
          amountCents: Math.round(Number(inst.amount) * 100),
          status: inst.status,
          origin: 'Financeiro',
        });
      }
      if (!entry.financial_installments?.length) {
        rows.push({
          id: entry.id,
          date: String(entry.event_date || entry.start_date || '').slice(0, 10),
          description: entry.description || 'Desconto de cota cooperativa',
          amountCents: Math.round(Number(entry.total_amount) * 100),
          status: entry.status,
          origin: 'Financeiro',
        });
      }
    }
    for (const settlement of conference.settlements) {
      for (const line of settlement.lines.filter((l) => l.kind === 'quota')) {
        rows.push({
          id: line.id,
          date: '',
          description: line.description || `Acerto — ${pharmacyDisplayName(settlement.pharmacies)}`,
          amountCents: Math.abs(line.driver_amount_cents),
          status: settlement.status,
          origin: 'Acerto de ciclo',
        });
      }
    }
    return rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [conference]);

  const refreshAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['billing', 'offboarding-conference', previewId] }),
      qc.invalidateQueries({ queryKey: ['billing', 'offboarding-preview', previewId] }),
      qc.invalidateQueries({ queryKey: ['billing', 'offboarding-previews'] }),
    ]);
  };

  const recalcMut = useMutation({
    mutationFn: () =>
      recalculateOffboardingPreview({
        driver_id: preview!.driver_id,
        last_worked_at: preview!.last_worked_at.slice(0, 10),
        task_id: preview!.task_id,
      }),
    onSuccess: async (next) => {
      await qc.invalidateQueries({ queryKey: ['billing', 'offboarding-previews'] });
      if (next.id !== previewId) {
        window.location.href = `/billing/desligamento/${next.id}`;
      } else {
        await refreshAll();
      }
    },
  });

  const syncMut = useMutation({
    mutationFn: (importMysql: boolean) => syncOffboardingDeliveries(previewId, importMysql),
    onSuccess: async () => {
      await refreshAll();
    },
  });

  const conferenceMut = useMutation({
    mutationFn: (checked: boolean) =>
      updateOffboardingConference(previewId, { checked, notes: notes || null }),
    onSuccess: async () => {
      await refreshAll();
    },
  });

  const quotaDecisionMut = useMutation({
    mutationFn: (input: { installment_id: string; decision: 'waived' | 'kept' | 'compensated' }) =>
      decideOffboardingPendingQuota(previewId, input),
    onSuccess: async () => {
      await refreshAll();
    },
  });

  const generatePayableMut = useMutation({
    mutationFn: () => generateOffboardingPayable(previewId),
    onSuccess: async (result) => {
      await refreshAll();
      if (result.payable_id) {
        window.location.href = `/billing/pagar?payable_id=${result.payable_id}&tab=driver`;
      }
    },
  });

  if (conferenceQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">Carregando mesa de conferência…</div>;
  }

  if (conferenceQuery.isError || !conference || !preview) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-destructive">Não foi possível carregar a conferência de desligamento.</p>
        <BillingBackLink href="/billing" label="Voltar para visão geral" />
      </div>
    );
  }

  const checklist = conference.checklist;
  const grossLines = preview.payload?.gross_lines || [];
  const discountLines = preview.payload?.discount_lines || [];
  const quotaRefundCents = grossLines
    .filter((l) => l.kind === 'quota_refund')
    .reduce((sum, l) => sum + l.amount_cents, 0);
  const totals = preview.payload?.totals;
  const operationalNetCents = totals
    ? Math.max(0, (totals.operational_gross_cents || 0) - (totals.operational_discount_cents || 0))
    : null;
  const capitalNetCents = totals
    ? Math.max(0, (totals.capital_gross_cents || 0) - (totals.capital_discount_cents || 0))
    : null;

  const pendingQuotas =
    conference.pending_quotas?.length
      ? conference.pending_quotas
      : (preview.payload?.pending_quota_lines || []).map((line) => ({
          installment_id: String(line.source_id || ''),
          entry_id: String(line.metadata?.entry_id || ''),
          label: line.label || 'Parcela de cota',
          amount_cents: line.amount_cents,
          due_date: line.metadata?.due_date ? String(line.metadata.due_date).slice(0, 10) : null,
          installment_number: null,
          decision:
            conference.conference_state.quota_decisions[String(line.source_id || '')] || null,
        }));
  const undecidedQuotaCount = pendingQuotas.filter((line) => !line.decision).length;
  const canDecideQuotas = preview.status === 'preview';
  const canRecalculatePreview = Boolean(preview.driver_id && preview.last_worked_at);

  const renderPendingQuotaDecisions = () => (
    <div className={billingKpiDetailClassName}>
      <h3 className="mb-1 text-sm font-semibold">Decisão sobre cotas pendentes</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Para cada parcela em aberto, escolha uma opção: cancelar a cobrança (não descontar), compensar no valor
        deste acerto ou manter a parcela pendente para cobrança futura.
      </p>
      {!canDecideQuotas && undecidedQuotaCount > 0 ? (
        <div className={cn('mb-3 px-3 py-2 text-xs', billingNoticeClassName('warning'))}>
          <p>
            Esta prévia está como <strong>{offboardingPreviewStatusLabel(preview.status)}</strong> e não aceita mais
            decisões de cota. Clique abaixo para abrir uma <strong>nova prévia em conferência</strong> e registrar as
            escolhas.
          </p>
          <Button
            size="sm"
            className="mt-2"
            disabled={recalcMut.isPending || !canRecalculatePreview}
            onClick={() => recalcMut.mutate()}
          >
            {recalcMut.isPending ? 'Gerando nova prévia…' : 'Nova prévia para decidir cotas'}
          </Button>
        </div>
      ) : null}
      {pendingQuotas.length ? (
        <ul className="space-y-2">
          {pendingQuotas.map((line) => (
            <li key={line.installment_id} className="rounded-lg border border-border/70 bg-background/50 p-3 text-xs">
              <div className="font-semibold">{line.label || 'Parcela de cota'}</div>
              <div className="mt-1 text-muted-foreground">
                Valor {formatBrlCents(line.amount_cents)}
                {line.installment_number != null ? ` · Parcela ${line.installment_number}` : ''}
                {line.due_date ? ` · Venc. ${fmtDate(line.due_date)}` : ''}
                {line.decision ? ` · ${quotaDecisionLabel(line.decision)}` : ''}
              </div>
              {!line.decision && canDecideQuotas ? (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-border/50 pt-3">
                  <Button
                    size="sm"
                    disabled={quotaDecisionMut.isPending}
                    onClick={() =>
                      quotaDecisionMut.mutate({
                        installment_id: line.installment_id,
                        decision: 'waived',
                      })
                    }
                  >
                    Cancelar cobrança
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={quotaDecisionMut.isPending}
                    onClick={() =>
                      quotaDecisionMut.mutate({
                        installment_id: line.installment_id,
                        decision: 'compensated',
                      })
                    }
                  >
                    Compensar no acerto
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={quotaDecisionMut.isPending}
                    onClick={() =>
                      quotaDecisionMut.mutate({
                        installment_id: line.installment_id,
                        decision: 'kept',
                      })
                    }
                  >
                    Manter pendente
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhuma parcela de cota aguardando decisão.</p>
      )}
    </div>
  );

  const renderTable = (
    headers: string[],
    rows: React.ReactNode[],
    empty = 'Nenhum registro.'
  ) => (
    <div className={billingTableShellClassName}>
      {rows.length ? (
        <table className="w-full text-sm">
          <thead className={billingTableHeadClassName}>
            <tr>
              {headers.map((h) => (
                <th key={h} className={cn(billingTableCellClassName, h.includes('right') ? 'text-right' : '')}>
                  {h.replace(' right', '')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      ) : (
        <p className="p-4 text-xs text-muted-foreground">{empty}</p>
      )}
    </div>
  );

  return (
    <BillingSection
      title={`Acerto de desligamento — ${driverName}`}
      desc={`Último dia trabalhado ${fmtDate(preview.last_worked_at)} · ${offboardingPreviewStatusLabel(preview.status)}`}
      icon={UserX}
      action={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={conferenceQuery.isFetching} onClick={() => void refreshAll()}>
            <RefreshCw className={cn('mr-1 h-3.5 w-3.5', conferenceQuery.isFetching && 'animate-spin')} />
            Atualizar
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={syncMut.isPending || !conference.integrations.flux_api_configured}
            onClick={() => syncMut.mutate(false)}
          >
            <Truck className="mr-1 h-3.5 w-3.5" />
            {syncMut.isPending ? 'Sincronizando…' : 'Importar entregas'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={recalcMut.isPending || !canRecalculatePreview}
            onClick={() => recalcMut.mutate()}
          >
            {recalcMut.isPending ? 'Recalculando…' : 'Recalcular prévia'}
          </Button>
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <BillingBackLink href="/billing" label="Voltar para visão geral" />
        <div className="flex flex-wrap gap-2">
          {preview.status === 'preview' ? (
            <>
              <Button
                size="sm"
                variant={checklist.conference_ok ? 'outline' : 'default'}
                disabled={conferenceMut.isPending}
                onClick={() => conferenceMut.mutate(!checklist.conference_ok)}
              >
                {checklist.conference_ok ? 'Reabrir conferência' : 'Marcar conferência OK'}
              </Button>
              <Button
                size="sm"
                disabled={generatePayableMut.isPending || !checklist.can_generate_payable}
                onClick={() => generatePayableMut.mutate()}
              >
                {generatePayableMut.isPending ? 'Gerando AP…' : 'Gerar AP'}
              </Button>
            </>
          ) : null}
          {preview.payable_id ? (
            <Link
              href={`/billing/pagar?payable_id=${preview.payable_id}&tab=driver`}
              className="inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent"
            >
              Abrir AP
            </Link>
          ) : null}
          {generatePayableMut.isError ? (
            <p className="w-full text-xs text-destructive">
              {generatePayableMut.error instanceof Error
                ? generatePayableMut.error.message
                : 'Falha ao gerar AP'}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { href: `/financial?driver_id=${driverId}`, label: 'Financeiro' },
          { href: `/billing/cotas`, label: 'Cotas' },
          { href: `/billing/entregas?driver_id=${driverId}`, label: 'Entregas' },
          {
            href:
              conference.settlements[0]
                ? `/billing/acertos/ciclo/${conference.settlements[0].billing_cycle_id}/farmacia/${conference.settlements[0].pharmacy_id}`
                : `/billing/acertos?driver_id=${driverId}`,
            label: 'Acerto de ciclo',
          },
        ].map((link) => (
          <Link
            key={link.label}
            href={link.href}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 text-xs font-medium text-primary hover:bg-accent"
          >
            {link.label}
            <ExternalLink className="h-3 w-3" />
          </Link>
        ))}
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        <div className={billingKpiDetailClassName}>
          <div className="text-xs font-semibold">Contexto operacional</div>
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <div>
              Assinatura:{' '}
              <span className={checklist.signature_signed ? 'text-success' : 'text-warning'}>
                {conference.operational.signature_label || conference.operational.signature_status || '—'}
              </span>
            </div>
            {conference.operational.signed_at ? (
              <div>Assinado em {fmtDate(conference.operational.signed_at)}</div>
            ) : null}
            {conference.operational.settlement_due_at ? (
              <div>Prazo acerto: {fmtDate(conference.operational.settlement_due_at)}</div>
            ) : null}
            {conference.operational.financial_task ? (
              <div>Tarefa financeira: {conference.operational.financial_task.title}</div>
            ) : null}
          </div>
        </div>

        <div className={billingKpiDetailClassName}>
          <div className="text-xs font-semibold">Checklist de liberação</div>
          <div className="mt-2 space-y-1.5">
            <ChecklistItem ok={checklist.cpf_ok} label="CPF cadastrado" />
            <ChecklistItem ok={checklist.pix_ok} label="PIX cadastrado" />
            <ChecklistItem ok={checklist.signature_signed} label="Termo de desligamento assinado" />
            <ChecklistItem ok={checklist.pending_entries_count === 0} label="Lançamentos financeiros conferidos" />
            <ChecklistItem ok={checklist.undecided_quota_count === 0} label="Cotas pendentes decididas" />
            <ChecklistItem
              ok={checklist.pending_quota_count === 0}
              label="Sem cotas em aberto para este acerto"
            />
            <ChecklistItem ok={checklist.conference_ok} label="Conferência marcada como OK" />
          </div>
        </div>

        <div className={billingKpiDetailClassName}>
          <div className="text-xs text-muted-foreground">Líquido a pagar</div>
          <div className="mt-1 font-mono text-2xl font-semibold">{formatBrlCents(preview.net_cents)}</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">Bruto </span>
              <span className="font-mono">{formatBrlCents(preview.gross_cents)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Descontos </span>
              <span className="font-mono text-destructive">{formatBrlCents(preview.discount_cents)}</span>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">Cotas a restituir </span>
              <span className="font-mono text-success">{formatBrlCents(quotaRefundCents)}</span>
            </div>
            {operationalNetCents != null ? (
              <div className="col-span-2 border-t border-border/60 pt-2">
                <span className="text-muted-foreground">Repasse operacional (CC farmácia) </span>
                <span className="font-mono">{formatBrlCents(operationalNetCents)}</span>
              </div>
            ) : null}
            {capitalNetCents != null ? (
              <div className="col-span-2">
                <span className="text-muted-foreground">Capital cooperativo (fora DRE) </span>
                <span className="font-mono text-success">{formatBrlCents(capitalNetCents)}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {undecidedQuotaCount > 0 ? (
        <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <p className="font-medium text-foreground">
            {undecidedQuotaCount} parcela(s) de cota precisam de decisão antes de gerar o pagamento.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {canDecideQuotas ? (
              <>
                Vá à aba <strong>Pendências</strong> ou <strong>Cotas</strong> e escolha: cancelar cobrança, compensar no
                acerto ou manter pendente.
              </>
            ) : (
              <>
                Esta prévia não está mais em conferência. Use <strong>Nova prévia para decidir cotas</strong> na aba
                Pendências.
              </>
            )}
          </p>
          <Button size="sm" className="mt-2" variant="outline" onClick={() => setTab('pendencias')}>
            {canDecideQuotas ? 'Decidir cotas pendentes' : 'Ir para Pendências'}
          </Button>
        </div>
      ) : null}

      {!checklist.can_generate_payable && checklist.blockers.length ? (
        <div className={cn('mb-4 px-4 py-3 text-xs', billingNoticeClassName('warning'))}>
          <div className="mb-1 flex items-center gap-2 font-semibold">
            <AlertCircle className="h-4 w-4" />
            Pendências antes de gerar AP
          </div>
          <ul className="list-inside list-disc space-y-0.5">
            {checklist.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {conference.warnings.length ? (
        <div className={cn('mb-4 px-4 py-3 text-xs', billingNoticeClassName('warning'))}>
          {conference.warnings.map((w) => (
            <p key={w}>{humanizeOffboardingWarning(w)}</p>
          ))}
        </div>
      ) : null}

      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Notas da conferência</label>
        <Textarea
          className="min-h-[72px] text-sm"
          value={notes || conference.conference_state.notes || ''}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            const current = conference.conference_state.notes || '';
            if (notes !== current) {
              void updateOffboardingConference(previewId, { notes: notes || null }).then(() => refreshAll());
            }
          }}
          placeholder="Observações do financeiro sobre este acerto…"
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className={billingTabsListClassName}>
          {[
            ['resumo', 'Resumo'],
            ['ciclo', 'Ciclo'],
            ['lancamentos', 'Lançamentos'],
            ['cotas', 'Cotas'],
            ['entregas', 'Entregas'],
            ['pendencias', `Pendências${undecidedQuotaCount ? ` (${undecidedQuotaCount})` : ''}`],
          ].map(([id, label]) => (
            <TabsTrigger key={id} value={id} className={billingTabsTriggerClassName}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="resumo" className="mt-4 space-y-3">
          <div className={billingKpiDetailClassName}>
            <h3 className="mb-3 text-sm font-semibold">Créditos e descontos do acerto final</h3>
            {renderTable(
              ['Tipo', 'Descrição', 'Valor right'],
              [
                ...grossLines.map((line, i) => (
                <tr key={`g-${i}`} className="border-b border-border/40">
                  <td className={billingTableCellClassName}>{offboardingLineKindLabel(line.kind)}</td>
                    <td className={billingTableCellClassName}>{line.label}</td>
                    <td className={cn(billingTableCellClassName, 'text-right font-mono text-success')}>
                      +{formatBrlCents(line.amount_cents)}
                    </td>
                  </tr>
                )),
                ...discountLines.map((line, i) => (
                <tr key={`d-${i}`} className="border-b border-border/40">
                  <td className={billingTableCellClassName}>{offboardingLineKindLabel(line.kind)}</td>
                    <td className={billingTableCellClassName}>{line.label}</td>
                    <td className={cn(billingTableCellClassName, 'text-right font-mono text-destructive')}>
                      −{formatBrlCents(line.amount_cents)}
                    </td>
                  </tr>
                )),
              ]
            )}
          </div>
          <div className="rounded-lg border border-border/70 bg-background/40 px-4 py-3 text-xs text-muted-foreground">
            <div>CPF: {preview.payload?.driver?.cpf || preview.drivers?.cpf || '—'}</div>
            <div>PIX: {preview.payload?.driver?.pix_key || '—'}</div>
          </div>
        </TabsContent>

        <TabsContent value="ciclo" className="mt-4 space-y-3">
          {conference.settlements.length ? (
            conference.settlements.map((settlement) => (
              <div key={settlement.id} className={billingKpiDetailClassName}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">
                      {pharmacyDisplayName(settlement.pharmacies)} ·{' '}
                      {settlement.billing_cycles?.label ||
                        `${fmtDate(settlement.billing_cycles?.apuracao_start || '')}–${fmtDate(settlement.billing_cycles?.apuracao_end || '')}`}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Status {settlement.status} · repasse {formatBrlCents(settlement.net_driver_payout_cents)}
                      {settlement.applied_mg ? ' · com MG' : ''}
                    </p>
                  </div>
                  <Link
                    href={`/billing/acertos/ciclo/${settlement.billing_cycle_id}/farmacia/${settlement.pharmacy_id}`}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Abrir acerto completo
                  </Link>
                </div>
                {renderTable(
                  ['Tipo', 'Descrição', 'Farmácia right', 'Entregador right'],
                  settlement.lines.map((line) => (
                    <tr key={line.id} className="border-b border-border/40">
                      <td className={billingTableCellClassName}>
                        {SETTLEMENT_LINE_KIND_LABELS[line.kind] || line.kind}
                      </td>
                      <td className={billingTableCellClassName}>
                        <button
                          type="button"
                          className={cn(
                            'text-left hover:text-primary',
                            line.metadata?.financial_entry_id && 'cursor-pointer underline-offset-2 hover:underline'
                          )}
                          onClick={() => {
                            const entryId = line.metadata?.financial_entry_id;
                            if (entryId) setEntryDrawerId(entryId);
                          }}
                        >
                          {line.description || '—'}
                        </button>
                      </td>
                      <td className={cn(billingTableCellClassName, 'text-right font-mono text-xs')}>
                        {line.pharmacy_amount_cents ? formatBrlCents(line.pharmacy_amount_cents) : '—'}
                      </td>
                      <td
                        className={cn(
                          billingTableCellClassName,
                          'text-right font-mono text-xs font-semibold',
                          line.driver_amount_cents < 0 ? 'text-destructive' : ''
                        )}
                      >
                        {formatBrlCents(line.driver_amount_cents)}
                      </td>
                    </tr>
                  ))
                )}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum acerto de ciclo aberto para este entregador.</p>
          )}
        </TabsContent>

        <TabsContent value="lancamentos" className="mt-4">
          {renderTable(
            ['Data', 'Tipo', 'Farmácia', 'Status', 'Valor right', ''],
            conference.financial_entries.map((entry) => (
              <tr key={entry.id} className="border-b border-border/40">
                <td className={billingTableCellClassName}>{fmtDate(entry.event_date || entry.start_date || '')}</td>
                <td className={billingTableCellClassName}>{ENTRY_TYPE_LABELS[entry.type] || entry.type}</td>
                <td className={billingTableCellClassName}>{pharmacyDisplayName(entry.pharmacies)}</td>
                <td className={billingTableCellClassName}>{entryStatusLabel(entry.status)}</td>
                <td className={cn(billingTableCellClassName, 'text-right font-mono')}>
                  {formatBrlCents(Math.round(Number(entry.total_amount) * 100))}
                </td>
                <td className={cn(billingTableCellClassName, 'text-right')}>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEntryDrawerId(entry.id)}>
                    Conferir
                  </Button>
                </td>
              </tr>
            )),
            'Nenhum lançamento financeiro no período.'
          )}
        </TabsContent>

        <TabsContent value="cotas" className="mt-4 space-y-3">
          {undecidedQuotaCount > 0 ? renderPendingQuotaDecisions() : null}

          {conference.quota_account ? (
            <div className="grid gap-3 md:grid-cols-4">
              {[
                ['Integralizado', conference.quota_account.integralized_cents],
                ['Saldo', conference.quota_account.balance_cents],
                ['Compensado', conference.quota_account.compensated_cents],
                ['Devolvido', conference.quota_account.refunded_cents],
              ].map(([label, cents]) => (
                <div key={String(label)} className="rounded-lg border border-border bg-muted/25 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
                  <div className="mt-1 font-mono text-sm font-semibold">{formatBrlCents(Number(cents))}</div>
                </div>
              ))}
            </div>
          ) : null}

          <div className={billingKpiDetailClassName}>
            <h3 className="mb-3 text-sm font-semibold">Histórico de descontos de cota</h3>
            {renderTable(
              ['Data', 'Origem', 'Descrição', 'Situação', 'Valor right'],
              quotaDiscountHistory.map((row) => (
                <tr key={row.id} className="border-b border-border/40">
                  <td className={billingTableCellClassName}>{row.date ? fmtDate(row.date) : '—'}</td>
                  <td className={billingTableCellClassName}>{row.origin}</td>
                  <td className={billingTableCellClassName}>{row.description}</td>
                  <td className={billingTableCellClassName}>
                    {row.origin === 'Financeiro'
                      ? installmentStatusLabel('quota', row.status)
                      : billingStatusLabel(row.status)}
                  </td>
                  <td className={cn(billingTableCellClassName, 'text-right font-mono text-destructive')}>
                    −{formatBrlCents(row.amountCents)}
                  </td>
                </tr>
              )),
              'Nenhum desconto de cota registrado para este cooperado.'
            )}
          </div>

          <div className={billingKpiDetailClassName}>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <WalletCards className="h-4 w-4" />
              Extrato da conta de cotas
            </h3>
            {renderTable(
              ['Data', 'Movimento', 'Descrição', 'Valor right'],
              (conference.quota_ledger || []).map((row) => (
                <tr key={row.id} className="border-b border-border/40">
                  <td className={billingTableCellClassName}>{fmtDate(row.created_at)}</td>
                  <td className={billingTableCellClassName}>{quotaLedgerEntryTypeLabel(row.entry_type)}</td>
                  <td className={billingTableCellClassName}>{row.description || '—'}</td>
                  <td className={cn(billingTableCellClassName, 'text-right font-mono')}>
                    {formatBrlCents(row.amount_cents)}
                  </td>
                </tr>
              )),
              'Sem movimentações na conta de cotas.'
            )}
          </div>

          {quotaRefundCents > 0 ? (
            <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
              Restituição prevista neste acerto: <strong>{formatBrlCents(quotaRefundCents)}</strong>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="entregas" className="mt-4">
          {renderTable(
            ['Data', 'Farmácia', 'Documento', 'Origem', 'Ciclo'],
            conference.deliveries.map((d) => (
              <tr key={d.id} className="border-b border-border/40">
                <td className={billingTableCellClassName}>{fmtDate(d.delivered_at)}</td>
                <td className={billingTableCellClassName}>{pharmacyDisplayName(d.pharmacies)}</td>
                <td className={billingTableCellClassName}>{d.document_number || '—'}</td>
                <td className={billingTableCellClassName}>
                  {(() => {
                    const badge = deliverySourceBadge(d.source);
                    return <span className={badge.className}>{badge.label}</span>;
                  })()}
                </td>
                <td className={billingTableCellClassName}>{d.billing_cycles?.label || '—'}</td>
              </tr>
            )),
            'Nenhuma entrega nos ciclos abertos.'
          )}
        </TabsContent>

        <TabsContent value="pendencias" className="mt-4 space-y-3">
          <div className={billingKpiDetailClassName}>
            <h3 className="mb-3 text-sm font-semibold">Lançamentos pendentes de aprovação</h3>
            {renderTable(
              ['Data', 'Tipo', 'Descrição', 'Valor right', ''],
              conference.financial_entries
                .filter((e) => ['pending_approval', 'draft', 'submitted'].includes(e.status))
                .map((entry) => (
                  <tr key={entry.id} className="border-b border-border/40">
                    <td className={billingTableCellClassName}>{fmtDate(entry.event_date || entry.start_date || '')}</td>
                    <td className={billingTableCellClassName}>{ENTRY_TYPE_LABELS[entry.type] || entry.type}</td>
                    <td className={billingTableCellClassName}>
                      {entry.description || absenceDispositionLabel(entry.absence_disposition) || '—'}
                    </td>
                    <td className={cn(billingTableCellClassName, 'text-right font-mono')}>
                      {formatBrlCents(Math.round(Number(entry.total_amount) * 100))}
                    </td>
                    <td className={cn(billingTableCellClassName, 'text-right')}>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEntryDrawerId(entry.id)}>
                        Aprovar / conferir
                      </Button>
                    </td>
                  </tr>
                )),
              'Nenhum lançamento pendente.'
            )}
          </div>

          {renderPendingQuotaDecisions()}

          {(preview.payload?.existing_payables || []).length ? (
            <div className={billingKpiDetailClassName}>
              <h3 className="mb-3 text-sm font-semibold">APs já existentes</h3>
              <ul className="space-y-1 text-xs">
                {(preview.payload?.existing_payables || []).map((line, i) => (
                  <li key={i}>
                    {line.label} — {formatBrlCents(line.amount_cents)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>

      {entryDrawerId ? (
        <ApprovalDrawer
          id={entryDrawerId}
          fallbackEntry={selectedEntry}
          discountRules={discountRules}
          canApprove={canApprove}
          onClose={() => setEntryDrawerId(null)}
          onRefresh={() => void refreshAll()}
          coverageMaps={coverageMaps}
        />
      ) : null}
    </BillingSection>
  );
}
