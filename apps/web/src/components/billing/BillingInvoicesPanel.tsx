'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Ban,
  Banknote,
  Barcode,
  CalendarRange,
  CircleDollarSign,
  Clock3,
  Download,
  ExternalLink,
  Eye,
  FileCheck2,
  FileText,
  Mail,
  MoreHorizontal,
  RefreshCw,
  Send,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { IconTile } from '@/components/ui/IconTile';
import { BillingCycleSelect } from '@/components/billing/BillingCycleSelect';
import { BillingCostCenterFilter } from '@/components/billing/BillingCostCenterFilter';
import { BillingPharmacyFilter } from '@/components/billing/BillingPharmacyFilter';
import {
  BillingActionFeedbackDialog,
  BillingDialogContent,
  BillingEmptyState,
  BillingField,
} from '@/components/billing/BillingPrimitives';
import { formTextareaClassName } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { PaginationControls } from '@/components/ui/PaginationControls';
import {
  billingInvoiceIsOverdue,
  billingKpiHeroClassName,
  billingKpiHeroLabelClassName,
  billingKpiHeroValueClassName,
  billingTableShellClassName,
  boletoReviveLabel,
  boletoReviveUiKey,
  documentStatusUiClass,
  entityBadgeClass,
  INVOICE_REVIVE_FILTER_OPTIONS,
  invoiceReviveDisplayStatus,
  invoiceStatusUiClass,
  nfseReviveLabel,
} from '@/lib/billing/billingReviveUi';
import {
  approveBillingInvoice,
  cancelBillingNfseDocument,
  cancelCoraBankSlip,
  downloadBillingBankSlipPdf,
  downloadBillingNfsePdf,
  downloadBillingNfseXml,
  emitCoraBankSlip,
  fetchBillingCycles,
  fetchBillingInvoices,
  generateBillingInvoices,
  reemitBillingNfseDocument,
  sendBillingInvoicePackageEmail,
  type BillingInvoice,
} from '@/lib/billing/billingApi';
import { pickDefaultOpenCycleId, readCycleParam, replaceQueryIfChanged, writeCycleParam } from '@/lib/billing/billingFilterUrl';
import { formatBrlCents, fmtDate } from '@/lib/billing/billingFormat';
import { useClientPagination } from '@/lib/billing/billingListUtils';
import { billingEntityLabel } from '@/lib/billing/billingLabels';
import { cadastroPageApi } from '@/lib/cadastro/cadastroPageApi';
import { apiErrorMessage, apiErrorPayload } from '@/lib/apiErrorMessage';
import { cn } from '@/lib/utils';

type InvoiceStatus = 'draft' | 'approved' | 'sent' | 'paid';
type EntityFilter = 'coop' | 'flux' | '';

const CANCEL_MOTIVO_OPTIONS = [
  { value: '1', label: '1 — Erro na emissão' },
  { value: '2', label: '2 — Serviço não prestado' },
  { value: '3', label: '3 — Outros' },
];

function invoiceRef(inv: BillingInvoice) {
  return inv.id.replace(/-/g, '').slice(0, 8).toUpperCase();
}

function pharmacyName(inv: BillingInvoice) {
  return inv.pharmacies?.trade_name || inv.pharmacies?.legal_name || '—';
}

function costCenterName(inv: BillingInvoice) {
  return inv.pharmacies?.billing_cost_centers?.name || null;
}

export function BillingInvoicesPanel() {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const cycleFromUrl = readCycleParam(searchParams);
  const statusFromUrl = (searchParams.get('status') || '') as InvoiceStatus | '';
  const entityFromUrl = (searchParams.get('entity') || '') as EntityFilter;
  const pharmacyFromUrl = searchParams.get('pharmacy_id') || '';
  const costCenterFromUrl = searchParams.get('cost_center_id') || '';

  const [cycleId, setCycleId] = useState(cycleFromUrl);
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | ''>(
    statusFromUrl === 'draft' || statusFromUrl === 'approved' || statusFromUrl === 'sent' || statusFromUrl === 'paid'
      ? statusFromUrl
      : ''
  );
  const [entityFilter, setEntityFilter] = useState<EntityFilter>(
    entityFromUrl === 'coop' || entityFromUrl === 'flux' ? entityFromUrl : ''
  );
  const [pharmacyId, setPharmacyId] = useState(pharmacyFromUrl);
  const [costCenterId, setCostCenterId] = useState(costCenterFromUrl);
  const [tomadorGateDialog, setTomadorGateDialog] = useState<{
    title: string;
    description: string;
    gaps: string[];
  } | null>(null);
  const [downloadBusyId, setDownloadBusyId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{
    documentId: string;
    pharmacyLabel: string;
  } | null>(null);
  const [cancelJustificativa, setCancelJustificativa] = useState('');
  const [cancelMotivo, setCancelMotivo] = useState<'1' | '2' | '3'>('1');

  const cyclesQuery = useQuery({ queryKey: ['billing', 'cycles'], queryFn: fetchBillingCycles });
  const cycles = useMemo(() => cyclesQuery.data || [], [cyclesQuery.data]);

  const invoicesQuery = useQuery({
    queryKey: ['billing', 'invoices', cycleId, statusFilter],
    queryFn: () =>
      fetchBillingInvoices({
        ...(cycleId ? { cycle_id: cycleId } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      }),
  });

  const pharmaciesQuery = useQuery({
    queryKey: ['pharmacies', 'billing-cc-map'],
    queryFn: () =>
      cadastroPageApi.fetchPharmacies({ status: 'active' }) as Promise<
        { id: string; billing_cost_center_id?: string | null }[]
      >,
  });

  const pharmacyCcMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const p of pharmaciesQuery.data || []) map.set(p.id, p.billing_cost_center_id || null);
    return map;
  }, [pharmaciesQuery.data]);

  useEffect(() => {
    if (!cycleFromUrl) return;
    setCycleId((prev) => (prev === cycleFromUrl ? prev : cycleFromUrl));
  }, [cycleFromUrl]);

  useEffect(() => {
    if (cycleId || !cycles.length) return;
    const preferred = pickDefaultOpenCycleId(cycles);
    if (preferred) setCycleId(preferred);
  }, [cycles, cycleId]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    writeCycleParam(params, cycleId);
    if (statusFilter) params.set('status', statusFilter);
    else params.delete('status');
    if (entityFilter) params.set('entity', entityFilter);
    else params.delete('entity');
    if (pharmacyId) params.set('pharmacy_id', pharmacyId);
    else params.delete('pharmacy_id');
    if (costCenterId) params.set('cost_center_id', costCenterId);
    else params.delete('cost_center_id');
    replaceQueryIfChanged(router, '/billing/faturamento', searchParams.toString(), params);
  }, [cycleId, statusFilter, entityFilter, pharmacyId, costCenterId, router, searchParams]);

  const generateMut = useMutation({
    mutationFn: () => generateBillingInvoices(cycleId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing', 'invoices'] }),
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => approveBillingInvoice(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing', 'invoices'] }),
    onError: (err) => {
      const payload = apiErrorPayload(err);
      if (payload?.code === 'NFSE_TOMADOR_INCOMPLETE') {
        const gaps = (payload.gaps || []).map((g) => g.label || g.code || '').filter(Boolean);
        setTomadorGateDialog({
          title: 'Cadastro fiscal incompleto',
          description:
            payload.error ||
            'Complete os dados fiscais da farmácia (tomador) antes de aprovar a fatura.',
          gaps: gaps.length ? gaps : ['Verifique CNPJ, endereço e código IBGE do município.'],
        });
        return;
      }
      setTomadorGateDialog({
        title: 'Não foi possível aprovar',
        description: apiErrorMessage(err),
        gaps: [],
      });
    },
  });

  const emitBoletoMut = useMutation({
    mutationFn: (id: string) => emitCoraBankSlip(id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['billing', 'invoices'] });
      const slip = res.bank_slip;
      setTomadorGateDialog({
        title: res.created ? 'Boleto emitido' : 'Boleto já existente',
        description: slip.digitable_line
          ? `Linha digitável: ${slip.digitable_line}`
          : slip.pdf_url
            ? `PDF: ${slip.pdf_url}`
            : `Status: ${slip.status}${slip.external_id ? ` · ${slip.external_id}` : ''}`,
        gaps: [],
      });
    },
    onError: (err) => {
      const payload = apiErrorPayload(err);
      const gaps = (payload?.gaps || []).map((g) => g.label || g.code || '').filter(Boolean);
      setTomadorGateDialog({
        title: 'Não foi possível emitir boleto',
        description: apiErrorMessage(err, 'Falha na emissão Cora.'),
        gaps,
      });
    },
  });

  const cancelBoletoMut = useMutation({
    mutationFn: (bankSlipId: string) => cancelCoraBankSlip(bankSlipId),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['billing', 'invoices'] });
      setTomadorGateDialog({
        title: 'Boleto cancelado',
        description: res.bank_slip.external_id
          ? `Cora ${res.bank_slip.external_id} · status ${res.bank_slip.status}`
          : `Status: ${res.bank_slip.status}`,
        gaps: [],
      });
    },
    onError: (err) => {
      setTomadorGateDialog({
        title: 'Não foi possível cancelar boleto',
        description: apiErrorMessage(err, 'Falha no cancelamento Cora.'),
        gaps: [],
      });
    },
  });

  const sendEmailMut = useMutation({
    mutationFn: (invoiceId: string) => sendBillingInvoicePackageEmail(invoiceId),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['billing', 'invoices'] });
      setTomadorGateDialog({
        title: res.dry_run ? 'Dry-run do e-mail' : 'E-mail enviado',
        description: res.dry_run
          ? `${res.note || 'SMTP não chamado.'} Destinatário: ${res.to}`
          : `Enviado para ${res.to} · ${res.attachments.length} anexo(s) · ${res.subject}`,
        gaps: res.attachments.map((a) => `${a.filename} (${a.bytes} bytes)`),
      });
    },
    onError: (err) => {
      const payload = apiErrorPayload(err) as { missing?: unknown } | null;
      const missing = Array.isArray(payload?.missing)
        ? (payload.missing as string[])
        : [];
      setTomadorGateDialog({
        title: 'Não foi possível enviar e-mail',
        description: apiErrorMessage(err, 'Pacote incompleto ou SMTP indisponível.'),
        gaps: missing.length
          ? missing.map((m) => `Faltando: ${m}`)
          : [],
      });
    },
  });

  const reemitMut = useMutation({
    mutationFn: (documentId: string) => reemitBillingNfseDocument(documentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing', 'invoices'] }),
    onError: (err) => {
      const payload = apiErrorPayload(err);
      if (payload?.code === 'NFSE_TOMADOR_INCOMPLETE') {
        const gaps = (payload.gaps || []).map((g) => g.label || g.code || '').filter(Boolean);
        setTomadorGateDialog({
          title: 'Cadastro fiscal incompleto',
          description:
            payload.error ||
            'Complete os dados fiscais da farmácia antes de reemitir a NFS-e.',
          gaps: gaps.length ? gaps : ['Verifique CNPJ, endereço e código IBGE do município.'],
        });
        return;
      }
      setTomadorGateDialog({
        title: 'Não foi possível reemitir',
        description: apiErrorMessage(err),
        gaps: [],
      });
    },
  });

  const cancelJustificativaTrimmed = cancelJustificativa.trim();
  const cancelJustificativaOk =
    cancelJustificativaTrimmed.length >= 15 && cancelJustificativaTrimmed.length <= 255;

  const cancelMut = useMutation({
    mutationFn: () => {
      if (!cancelTarget) throw new Error('Documento NFS-e não selecionado');
      return cancelBillingNfseDocument(cancelTarget.documentId, {
        justificativa: cancelJustificativaTrimmed,
        codigo_motivo: cancelMotivo,
      });
    },
    onSuccess: (result) => {
      setCancelTarget(null);
      setCancelJustificativa('');
      setCancelMotivo('1');
      qc.invalidateQueries({ queryKey: ['billing', 'invoices'] });
      if (!result.canceled) {
        setTomadorGateDialog({
          title: 'Cancelamento não concluído',
          description: result.error || 'A Sefin não confirmou o cancelamento da NFS-e.',
          gaps: [],
        });
      }
    },
    onError: (err) => {
      setTomadorGateDialog({
        title: 'Não foi possível cancelar',
        description: apiErrorMessage(err),
        gaps: [],
      });
    },
  });

  async function handleDownloadXml(documentId: string) {
    setDownloadBusyId(`${documentId}:xml`);
    try {
      await downloadBillingNfseXml(documentId);
    } catch (err) {
      setTomadorGateDialog({
        title: 'Download XML indisponível',
        description: apiErrorMessage(err),
        gaps: [],
      });
    } finally {
      setDownloadBusyId(null);
    }
  }

  async function handleDownloadPdf(documentId: string) {
    setDownloadBusyId(`${documentId}:pdf`);
    try {
      await downloadBillingNfsePdf(documentId);
    } catch (err) {
      setTomadorGateDialog({
        title: 'Download PDF indisponível',
        description: apiErrorMessage(err),
        gaps: [],
      });
    } finally {
      setDownloadBusyId(null);
    }
  }

  async function handleDownloadBoleto(bankSlipId: string) {
    setDownloadBusyId(`${bankSlipId}:boleto`);
    try {
      await downloadBillingBankSlipPdf(bankSlipId);
    } catch (err) {
      setTomadorGateDialog({
        title: 'Download do boleto indisponível',
        description: apiErrorMessage(err),
        gaps: [],
      });
    } finally {
      setDownloadBusyId(null);
    }
  }

  function openCancelDialog(documentId: string, pharmacyLabel: string) {
    setCancelJustificativa('');
    setCancelMotivo('1');
    setCancelTarget({ documentId, pharmacyLabel });
  }

  const rows = useMemo(() => {
    let list = invoicesQuery.data || [];
    if (entityFilter) list = list.filter((inv) => inv.entity_type === entityFilter);
    if (pharmacyId) list = list.filter((inv) => inv.pharmacy_id === pharmacyId);
    if (costCenterId) {
      list = list.filter((inv) => {
        const fromJoin = inv.pharmacies?.billing_cost_center_id;
        const cc = fromJoin ?? pharmacyCcMap.get(inv.pharmacy_id) ?? null;
        return cc === costCenterId;
      });
    }
    return list;
  }, [invoicesQuery.data, entityFilter, pharmacyId, costCenterId, pharmacyCcMap]);

  const resumo = useMemo(() => {
    const total = rows.reduce((acc, inv) => acc + inv.total_cents, 0);
    const aberto = rows.filter((inv) => inv.status !== 'paid');
    const vencidas = rows.filter((inv) => billingInvoiceIsOverdue(inv.status, inv.due_date));
    return {
      total,
      aberto: aberto.reduce((acc, inv) => acc + Math.max(0, inv.total_cents - (inv.amount_paid_cents || 0)), 0),
      abertas: aberto.length,
      vencido: vencidas.reduce((acc, inv) => acc + Math.max(0, inv.total_cents - (inv.amount_paid_cents || 0)), 0),
      vencidas: vencidas.length,
    };
  }, [rows]);

  const pagination = useClientPagination(rows);

  useEffect(() => {
    pagination.resetPage();
  }, [cycleId, statusFilter, entityFilter, pharmacyId, costCenterId]);

  const allInvoices = invoicesQuery.data || [];

  return (
    <div className="space-y-5 pb-8">
      <section className="grid gap-3 md:grid-cols-3">
        <div className={billingKpiHeroClassName}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className={billingKpiHeroLabelClassName}>Faturado no ciclo</p>
              <p className={billingKpiHeroValueClassName}>{formatBrlCents(resumo.total)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {rows.length} {rows.length === 1 ? 'fatura gerada' : 'faturas geradas'}
              </p>
            </div>
            <IconTile icon={CircleDollarSign} tone="primary" size="lg" />
          </div>
        </div>
        <div className={billingKpiHeroClassName}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className={billingKpiHeroLabelClassName}>A receber</p>
              <p className={cn(billingKpiHeroValueClassName, 'text-warning')}>{formatBrlCents(resumo.aberto)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {resumo.abertas} {resumo.abertas === 1 ? 'cobrança pendente' : 'cobranças pendentes'}
              </p>
            </div>
            <IconTile icon={Clock3} tone="warning" size="lg" />
          </div>
        </div>
        <div className={billingKpiHeroClassName}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className={billingKpiHeroLabelClassName}>Vencido</p>
              <p className={cn(billingKpiHeroValueClassName, 'text-destructive')}>{formatBrlCents(resumo.vencido)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {resumo.vencidas
                  ? `${resumo.vencidas} ${resumo.vencidas === 1 ? 'fatura exige' : 'faturas exigem'} atenção`
                  : 'Nenhuma pendência vencida'}
              </p>
            </div>
            <IconTile icon={AlertTriangle} tone="destructive" size="lg" />
          </div>
        </div>
      </section>

      <section className={cn(billingTableShellClassName, 'overflow-hidden shadow-sm')}>
        <div className="grid gap-3 border-b border-border p-4 lg:grid-cols-5">
          <BillingCycleSelect
            value={cycleId}
            onChange={setCycleId}
            cycles={cycles}
            label="Filtrar por ciclo"
            allowEmpty
            emptyLabel="Todos os ciclos"
            className="min-w-0"
            selectClassName="mt-1.5 w-full"
          />
          <BillingPharmacyFilter value={pharmacyId} onChange={setPharmacyId} className="min-w-0" />
          <BillingCostCenterFilter value={costCenterId} onChange={setCostCenterId} className="min-w-0" />
          <BillingField label="Entidade" className="min-w-0">
            <FormSelect
              className="mt-1.5 w-full"
              size="sm"
              value={entityFilter}
              onChange={(v) => setEntityFilter(v as EntityFilter)}
              options={[
                { value: '', label: 'Todas' },
                { value: 'coop', label: 'CoopMob' },
                { value: 'flux', label: 'Flux Farma' },
              ]}
            />
          </BillingField>
          <BillingField label="Status" className="min-w-0">
            <FormSelect
              className="mt-1.5 w-full"
              size="sm"
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as InvoiceStatus | '')}
              options={INVOICE_REVIVE_FILTER_OPTIONS as { value: InvoiceStatus | ''; label: string }[]}
            />
          </BillingField>
        </div>

        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Faturas geradas a partir dos acertos aprovados · NFS-e, boleto e envio por e-mail
          </p>
          {cycleId ? (
            <Button
              variant="outline"
              className="h-10"
              onClick={() => generateMut.mutate()}
              disabled={generateMut.isPending}
            >
              <RefreshCw className="mr-2 h-4 w-4" /> Gerar faturas do ciclo
            </Button>
          ) : null}
        </div>

        {!allInvoices.length && !invoicesQuery.isLoading ? (
          <div className="px-6 py-16 text-center">
            <IconTile icon={FileText} tone="primary" size="xl" className="mx-auto mb-4" />
            <h2 className="font-semibold">Nenhuma fatura emitida ainda</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Aprove um acerto para gerar automaticamente as faturas da CoopMob e da Flux Farma.
            </p>
          </div>
        ) : !rows.length && !invoicesQuery.isLoading ? (
          <div className="px-6 py-14 text-center">
            <BillingEmptyState>Nenhuma fatura encontrada com os filtros atuais.</BillingEmptyState>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1220px] text-left text-sm">
              <thead className="border-b border-border bg-background/35 text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">
                <tr>
                  <th className="px-5 py-3.5">Fatura</th>
                  <th className="px-5 py-3.5">Farmácia</th>
                  <th className="px-5 py-3.5">Entidade</th>
                  <th className="px-5 py-3.5">Ciclo</th>
                  <th className="px-5 py-3.5">Vencimento</th>
                  <th className="px-5 py-3.5 text-right">Valor</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5">NFS-e</th>
                  <th className="px-5 py-3.5">Boleto</th>
                  <th className="w-16 px-5 py-3.5 text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {pagination.pageItems.map((inv) => {
                  const display = invoiceReviveDisplayStatus(inv.status, inv.due_date);
                  const ccName = costCenterName(inv);
                  const canEmitBoleto =
                    inv.entity_type === 'flux' &&
                    (inv.status === 'approved' || inv.status === 'sent') &&
                    (!inv.bank_slip ||
                      inv.bank_slip.status === 'error' ||
                      inv.bank_slip.status === 'canceled');
                  const hasBoletoPdf = Boolean(
                    inv.bank_slip?.id && (inv.bank_slip.has_pdf_storage || inv.bank_slip.pdf_url)
                  );
                  const canCancelBoleto = Boolean(
                    inv.bank_slip?.id &&
                      (inv.bank_slip.status === 'open' || inv.bank_slip.status === 'pending')
                  );
                  const nfseAuthorized = inv.nfse?.status === 'authorized' && inv.nfse.id;
                  const nfseReemit =
                    (inv.nfse?.status === 'rejected' || inv.nfse?.status === 'canceled') && inv.nfse.id;

                  return (
                    <tr key={inv.id} className="group transition-colors hover:bg-surface-hover/60">
                      <td className="px-5 py-4">
                        <div className="font-mono text-xs font-medium text-foreground">{invoiceRef(inv)}</div>
                        {inv.nfse?.dps_number ? (
                          <div className="mt-1 text-[11px] text-subtle-foreground">DPS {inv.nfse.dps_number}</div>
                        ) : null}
                      </td>
                      <td className="px-5 py-4">
                        <div className="font-medium">{pharmacyName(inv)}</div>
                        {ccName ? <div className="mt-0.5 text-xs text-muted-foreground">{ccName}</div> : null}
                      </td>
                      <td className="px-5 py-4">
                        <span className={entityBadgeClass(inv.entity_type)}>
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          {billingEntityLabel(inv.entity_type)}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        {inv.billing_cycles?.apuracao_start && inv.billing_cycles?.apuracao_end ? (
                          <div className="flex items-center gap-1.5 whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                            <CalendarRange className="h-3.5 w-3.5" />
                            {fmtDate(inv.billing_cycles.apuracao_start)} — {fmtDate(inv.billing_cycles.apuracao_end)}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">{inv.billing_cycles?.label || '—'}</span>
                        )}
                      </td>
                      <td className="px-5 py-4 font-mono text-xs text-muted-foreground">
                        {inv.due_date ? fmtDate(inv.due_date) : '—'}
                      </td>
                      <td className="px-5 py-4 text-right font-mono font-semibold tabular-nums">
                        {formatBrlCents(inv.total_cents)}
                      </td>
                      <td className="px-5 py-4">
                        <span className={invoiceStatusUiClass(display.key)}>
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          {display.label}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <FileCheck2 className="h-4 w-4 text-subtle-foreground" />
                          <div>
                            <span className={documentStatusUiClass(inv.nfse?.status || 'pending')}>
                              {nfseReviveLabel(inv.nfse?.status)}
                            </span>
                            {inv.nfse?.access_key ? (
                              <p className="mt-1 max-w-[140px] truncate font-mono text-[10px] text-subtle-foreground" title={inv.nfse.access_key}>
                                {inv.nfse.access_key.slice(-8)}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <Barcode className="h-4 w-4 text-subtle-foreground" />
                          <span
                            className={documentStatusUiClass(
                              boletoReviveUiKey(inv.bank_slip?.status, inv.due_date, inv.status)
                            )}
                          >
                            {boletoReviveLabel(inv.bank_slip?.status, inv.due_date, inv.status)}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label={`Ações da fatura ${invoiceRef(inv)}`}
                              />
                            }
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuGroup>
                              {inv.entity_type === 'coop' ? (
                                <DropdownMenuItem
                                  render={
                                    <Link href={`/public/billing/${inv.public_token}`} target="_blank" />
                                  }
                                >
                                  <Eye className="mr-2 h-4 w-4" /> Visualizar fatura
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem disabled>
                                  <Eye className="mr-2 h-4 w-4" /> Relatório CoopMob
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuGroup>

                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                              <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-subtle-foreground">
                                Boleto
                              </DropdownMenuLabel>
                              {canEmitBoleto ? (
                                <DropdownMenuItem
                                  disabled={emitBoletoMut.isPending}
                                  onClick={() => emitBoletoMut.mutate(inv.id)}
                                >
                                  <Banknote className="mr-2 h-4 w-4" /> Emitir boleto
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuItem
                                disabled={!hasBoletoPdf || downloadBusyId === `${inv.bank_slip?.id}:boleto`}
                                onClick={() => inv.bank_slip?.id && handleDownloadBoleto(inv.bank_slip.id)}
                              >
                                <Barcode className="mr-2 h-4 w-4" /> PDF do boleto
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={!canCancelBoleto || cancelBoletoMut.isPending}
                                onClick={() => {
                                  if (
                                    !inv.bank_slip?.id ||
                                    !window.confirm(
                                      'Cancelar este boleto na Cora? Só use após validar. NFS-e não é afetada.'
                                    )
                                  ) {
                                    return;
                                  }
                                  cancelBoletoMut.mutate(inv.bank_slip.id);
                                }}
                              >
                                <Ban className="mr-2 h-4 w-4" /> Cancelar boleto
                              </DropdownMenuItem>
                            </DropdownMenuGroup>

                            <DropdownMenuSeparator />
                            <DropdownMenuGroup>
                              <DropdownMenuLabel className="text-[11px] uppercase tracking-wide text-subtle-foreground">
                                NFS-e
                              </DropdownMenuLabel>
                              <DropdownMenuItem
                                disabled={!nfseAuthorized || downloadBusyId === `${inv.nfse?.id}:pdf`}
                                onClick={() => inv.nfse?.id && handleDownloadPdf(inv.nfse.id)}
                              >
                                <FileText className="mr-2 h-4 w-4" /> PDF da NFS-e
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={!nfseAuthorized || downloadBusyId === `${inv.nfse?.id}:xml`}
                                onClick={() => inv.nfse?.id && handleDownloadXml(inv.nfse.id)}
                              >
                                <FileCheck2 className="mr-2 h-4 w-4" /> XML da NFS-e
                              </DropdownMenuItem>
                              {inv.nfse?.access_key ? (
                                <DropdownMenuItem
                                  render={
                                    <a
                                      href={`https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=${encodeURIComponent(inv.nfse.access_key)}`}
                                      target="_blank"
                                      rel="noreferrer"
                                    />
                                  }
                                >
                                  <ExternalLink className="mr-2 h-4 w-4" /> Consulta pública
                                </DropdownMenuItem>
                              ) : null}
                              {nfseAuthorized ? (
                                <DropdownMenuItem
                                  disabled={sendEmailMut.isPending}
                                  onClick={() => {
                                    const pharmacy = pharmacyName(inv);
                                    if (
                                      !window.confirm(
                                        `Enviar pacote da fatura por e-mail para a ${pharmacy}?\n\nAnexos: boleto PDF + DANFSe PDF + XML.\nCorpo: link HTML da fatura.\nDestinatário: billing_email ?? email do cadastro.\n\nConfirme o e-mail no cadastro antes de enviar a uma farmácia real.`
                                      )
                                    ) {
                                      return;
                                    }
                                    sendEmailMut.mutate(inv.id);
                                  }}
                                >
                                  <Mail className="mr-2 h-4 w-4" /> Enviar e-mail
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={!nfseAuthorized || cancelMut.isPending}
                                onClick={() =>
                                  inv.nfse?.id && openCancelDialog(inv.nfse.id, pharmacyName(inv))
                                }
                              >
                                <Ban className="mr-2 h-4 w-4" /> Cancelar NFS-e
                              </DropdownMenuItem>
                              {nfseReemit ? (
                                <DropdownMenuItem
                                  disabled={reemitMut.isPending}
                                  onClick={() => inv.nfse?.id && reemitMut.mutate(inv.nfse.id)}
                                >
                                  <RefreshCw className="mr-2 h-4 w-4" /> Reemitir NFS-e
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuGroup>

                            {inv.status === 'draft' ? (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuGroup>
                                  <DropdownMenuItem
                                    disabled={approveMut.isPending}
                                    onClick={() => approveMut.mutate(inv.id)}
                                  >
                                    <Send className="mr-2 h-4 w-4" /> Aprovar fatura
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {allInvoices.length > 0 ? (
          <div className="flex flex-col gap-2 border-t border-border bg-background/25 px-5 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>
              Exibindo {pagination.pageItems.length} de {rows.length} faturas
              {rows.length !== allInvoices.length ? ` (filtradas de ${allInvoices.length})` : ''}
            </span>
            {pagination.totalItems > pagination.pageSize ? (
              <PaginationControls
                page={pagination.page}
                pageSize={pagination.pageSize}
                totalItems={pagination.totalItems}
                onPageChange={pagination.setPage}
                itemLabel="faturas"
              />
            ) : (
              <span>Valores atualizados conforme o ciclo selecionado</span>
            )}
          </div>
        ) : null}
      </section>

      <Dialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => {
          if (!open && !cancelMut.isPending) {
            setCancelTarget(null);
            setCancelJustificativa('');
            setCancelMotivo('1');
          }
        }}
      >
        {cancelTarget ? (
          <BillingDialogContent
            title="Cancelar NFS-e"
            description="Envia o evento de cancelamento à Sefin Nacional. Esta ação não pode ser desfeita na nota atual."
            footer={
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setCancelTarget(null);
                    setCancelJustificativa('');
                    setCancelMotivo('1');
                  }}
                  disabled={cancelMut.isPending}
                >
                  Voltar
                </Button>
                <Button
                  disabled={!cancelJustificativaOk || cancelMut.isPending}
                  onClick={() => cancelMut.mutate()}
                >
                  {cancelMut.isPending ? 'Cancelando…' : 'Confirmar cancelamento'}
                </Button>
              </>
            }
          >
            <div className="rounded-lg border border-border bg-background/40 px-3 py-2 text-xs">
              <div className="font-medium">{cancelTarget.pharmacyLabel}</div>
              <div className="mt-1 text-muted-foreground">
                Após o cancelamento, use Reemitir para gerar uma nova NFS-e com os dados corrigidos.
              </div>
            </div>
            <BillingField label="Motivo (código Sefin)">
              <FormSelect
                className="mt-1 w-full"
                size="sm"
                value={cancelMotivo}
                onChange={(v) => setCancelMotivo(v as '1' | '2' | '3')}
                options={CANCEL_MOTIVO_OPTIONS}
              />
            </BillingField>
            <BillingField label="Justificativa (15 a 255 caracteres)">
              <textarea
                className={cn(formTextareaClassName, 'mt-1')}
                value={cancelJustificativa}
                placeholder="Ex.: Erro no local de prestação da NFS-e — município do tomador incorreto"
                maxLength={255}
                rows={4}
                onChange={(e) => setCancelJustificativa(e.target.value)}
              />
              <div className="mt-1 text-[11px] text-muted-foreground">
                {cancelJustificativaTrimmed.length}/255
                {!cancelJustificativaOk && cancelJustificativaTrimmed.length > 0
                  ? ' — mínimo 15 caracteres'
                  : null}
              </div>
            </BillingField>
          </BillingDialogContent>
        ) : null}
      </Dialog>

      <Dialog open={Boolean(tomadorGateDialog)} onOpenChange={(open) => !open && setTomadorGateDialog(null)}>
        {tomadorGateDialog ? (
          <BillingActionFeedbackDialog
            open
            onOpenChange={(open) => !open && setTomadorGateDialog(null)}
            title={tomadorGateDialog.title}
            description={tomadorGateDialog.description}
            items={tomadorGateDialog.gaps}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
