'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCircle2, CloudDownload, Database, Download, Plus, RefreshCw, Upload } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { CadastroSearchCombobox } from '@/components/cadastro/CadastroSearchCombobox';
import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';
import { FormSelect } from '@/components/form/FormSelect';
import { BillingEntityName } from '@/components/billing/BillingEntityName';
import { BillingDialogContent, BillingEmptyState, BillingField } from '@/components/billing/BillingPrimitives';
import { FormControl } from '@/components/form/FormControl';
import { apiErrorMessage, apiErrorPayload } from '@/lib/apiErrorMessage';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { cadastroPageApi } from '@/lib/cadastro/cadastroPageApi';
import {
  createBillingDelivery,
  fetchBillingCycles,
  fetchBillingDeliveries,
  importBillingDeliveriesAtivmob,
  verifyBillingDelivery,
  type BillingAtivmobImportResult,
  type BillingDelivery,
} from '@/lib/billing/billingApi';
import {
  fireFluxDeliverySync,
  fireMysqlReconcile,
  formatBillingSyncRangeLabel,
  resolveBillingSyncRange,
} from '@/lib/billing/billingFluxIngest';
import { pharmacyDisplayName } from '@/lib/billing/billingDisplay';
import { readCycleParam, replaceQueryIfChanged, writeCycleParam } from '@/lib/billing/billingFilterUrl';
import {
  billingKpiCompactClassName,
  billingKpiLabelClassName,
  billingTableHeadClassName,
  billingTableCellClassName,
  billingTableShellClassName,
  contagemPorOrigem,
  deliverySourceBadge,
  type DeliverySourceKey,
} from '@/lib/billing/billingReviveUi';
import { cleanBillingLabel } from '@/lib/billing/billingDisplay';
import {
  addBillingDeliveryNotificationSafe,
  clearBillingDeliveryNotifications,
  compactJsonDetail,
  listBillingDeliveryNotifications,
  subscribeBillingDeliveryNotifications,
  type BillingDeliveryNotification,
} from '@/lib/billing/billingDeliveryNotifications';
import { isDriverLinkedToPharmacy } from '@/lib/billing/isDriverLinkedToPharmacy';

type DriverRow = {
  id: string;
  name: string;
  primary_pharmacy_id?: string | null;
  driver_pharmacy_links?: Array<{
    is_active?: boolean;
    pharmacies?: { id: string } | null;
  }>;
};
type PharmacyRow = { id: string; name?: string; trade_name?: string | null; legal_name?: string | null; status?: string };

const ORIGEM_KPIS: DeliverySourceKey[] = ['flux_api', 'flux_db', 'manual', 'external_app'];
const ATIVMOB_TEMPLATE_URL = '/templates/ativmob-entregas-modelo.xlsx';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || '');
      resolve(value.includes(',') ? value.split(',')[1] : value);
    };
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler arquivo'));
    reader.readAsDataURL(file);
  });
}

export function BillingDeliveriesPanel() {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const cycleFromUrl = readCycleParam(searchParams);
  const driverFromUrl = searchParams.get('driver_id') || '';
  const [cycleId, setCycleId] = useState(cycleFromUrl);
  const [pharmacyFilter, setPharmacyFilter] = useState('todas');
  const [driverFilter, setDriverFilter] = useState(driverFromUrl || 'todos');
  const [open, setOpen] = useState(false);
  const [pharmacyId, setPharmacyId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [deliveredAt, setDeliveredAt] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [routeId, setRouteId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [excelOpen, setExcelOpen] = useState(false);
  const [ativmobFile, setAtivmobFile] = useState<File | null>(null);
  const [ativmobCycleId, setAtivmobCycleId] = useState(cycleFromUrl);
  const [ativmobResult, setAtivmobResult] = useState<BillingAtivmobImportResult | null>(null);
  const [ativmobError, setAtivmobError] = useState<string | null>(null);
  const [ativmobUnmapped, setAtivmobUnmapped] = useState<{ type: string; value: string }[]>([]);
  const [ativmobUnmappedSummary, setAtivmobUnmappedSummary] = useState<
    { type: string; value: string; count: number }[]
  >([]);
  const [page, setPage] = useState(1);
  const [notifications, setNotifications] = useState<BillingDeliveryNotification[]>([]);

  const cyclesQuery = useQuery({ queryKey: ['billing', 'cycles'], queryFn: fetchBillingCycles });

  const deliveriesQuery = useQuery({
    queryKey: ['billing', 'deliveries', cycleId || 'all', pharmacyFilter, driverFilter, page],
    queryFn: () =>
      fetchBillingDeliveries({
        page,
        limit: 20,
        ...(cycleId ? { cycle_id: cycleId } : {}),
        ...(pharmacyFilter !== 'todas' ? { pharmacy_id: pharmacyFilter } : {}),
        ...(driverFilter !== 'todos' ? { driver_id: driverFilter } : {}),
      }),
  });

  useEffect(() => {
    if (!cycleFromUrl) return;
    setCycleId((prev) => (prev === cycleFromUrl ? prev : cycleFromUrl));
  }, [cycleFromUrl]);

  useEffect(() => {
    if (!driverFromUrl) return;
    setDriverFilter((prev) => (prev === driverFromUrl ? prev : driverFromUrl));
  }, [driverFromUrl]);

  useEffect(() => {
    setNotifications(listBillingDeliveryNotifications());
    return subscribeBillingDeliveryNotifications(() => {
      setNotifications(listBillingDeliveryNotifications());
    });
  }, []);

  const onCycleChange = (id: string) => {
    if (id === cycleId) return;
    setCycleId(id);
    setPage(1);
    const params = new URLSearchParams(searchParams.toString());
    writeCycleParam(params, id);
    replaceQueryIfChanged(router, '/billing/entregas', searchParams.toString(), params);
  };

  const driversQuery = useQuery({
    queryKey: ['drivers', 'active'],
    queryFn: () => api.get('/api/drivers', { params: { status: 'active' } }).then((r) => r.data as DriverRow[]),
  });

  const pharmaciesQuery = useQuery({
    queryKey: ['pharmacies', 'billing', 'all'],
    queryFn: () => cadastroPageApi.fetchPharmacies() as Promise<PharmacyRow[]>,
  });

  const createMut = useMutation({
    mutationFn: () => {
      const qty = Math.min(500, Math.max(1, Math.floor(Number(quantity) || 1)));
      return createBillingDelivery({
        pharmacy_id: pharmacyId,
        driver_id: driverId,
        ...(deliveredAt.trim()
          ? { delivered_at: new Date(deliveredAt).toISOString() }
          : {}),
        document_number: documentNumber.trim() || undefined,
        route_id: routeId.trim() || undefined,
        billing_cycle_id: cycleId || null,
        verified: false,
        quantity: qty,
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['billing', 'deliveries'] });
      setOpen(false);
      setPharmacyId('');
      setDriverId('');
      setDeliveredAt('');
      setDocumentNumber('');
      setRouteId('');
      setQuantity(1);
    },
  });

  const verifyMut = useMutation({
    mutationFn: (id: string) => verifyBillingDelivery(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing', 'deliveries'] }),
  });

  const importAtivmobMut = useMutation({
    mutationFn: async () => {
      if (!ativmobFile) throw new Error('Selecione um arquivo Excel.');
      const file_base64 = await fileToBase64(ativmobFile);
      return importBillingDeliveriesAtivmob({
        file_base64,
        billing_cycle_id: ativmobCycleId || null,
      });
    },
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: ['billing', 'deliveries'] });
      addBillingDeliveryNotificationSafe({
        kind: result.unmapped_count ? 'warning' : 'success',
        source: 'ativmob',
        title: 'Importação ATIVMOB concluída',
        message:
          result.operator_message ||
          `A planilha ATIVMOB foi processada: ${result.imported} entregas gravadas e ${result.unmapped_count} pendências de mapeamento.`,
        detail: compactJsonDetail({
          stats: result.stats,
          unmapped_count: result.unmapped_count,
          unmapped_summary: (result.unmapped_summary || []).slice(0, 20),
        }),
      });
      setAtivmobResult(result);
      setAtivmobError(null);
      setAtivmobUnmapped(result.unmapped_sample || []);
      setAtivmobUnmappedSummary(result.unmapped_summary || []);
      setPage(1);
    },
    onError: (error) => {
      const payload = apiErrorPayload(error) as
        | {
            unmapped_sample?: { type: string; value: string }[];
            unmapped_summary?: { type: string; value: string; count: number }[];
            operator_message?: string;
          }
        | null;
      const message =
        payload?.operator_message ||
        apiErrorMessage(error, 'Não foi possível importar a planilha ATIVMOB.');
      addBillingDeliveryNotificationSafe({
        kind: 'error',
        source: 'ativmob',
        title: 'Importação ATIVMOB não concluída',
        message,
        detail: compactJsonDetail({
          operator_message: payload?.operator_message,
          unmapped_summary: (payload?.unmapped_summary || []).slice(0, 20),
        }),
      });
      setAtivmobError(message);
      setAtivmobUnmapped(payload?.unmapped_sample || []);
      setAtivmobUnmappedSummary(payload?.unmapped_summary || []);
    },
  });

  const allRows = deliveriesQuery.data?.deliveries || [];
  const filtered = allRows;
  const totalRows = deliveriesQuery.data?.total ?? 0;
  const totalPages = deliveriesQuery.data?.total_pages ?? 1;
  const summary = deliveriesQuery.data?.summary;

  // KPIs usam o summary do mesmo filtro da listagem (não só a página atual).
  const origemKpis = useMemo(() => {
    if (summary?.by_source) return summary.by_source;
    return contagemPorOrigem(filtered);
  }, [summary, filtered]);
  const totalApurado = summary?.verified_total ?? filtered.filter((r) => !r.cancelled && r.verified).length;

  const cycles = cyclesQuery.data || [];
  const selectedCycle = cycles.find((c) => c.id === cycleId) || null;
  const syncRange = useMemo(() => resolveBillingSyncRange(selectedCycle), [selectedCycle]);

  const syncFluxMut = useMutation({
    mutationFn: () => fireFluxDeliverySync(syncRange),
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ['billing', 'deliveries'] });
    },
  });

  const syncMysqlMut = useMutation({
    mutationFn: () => fireMysqlReconcile(syncRange),
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ['billing', 'deliveries'] });
    },
  });

  const syncInFlight = syncFluxMut.isPending || syncMysqlMut.isPending;

  const drivers = useMemo(() => driversQuery.data || [], [driversQuery.data]);
  const pharmacies = useMemo(() => pharmaciesQuery.data || [], [pharmaciesQuery.data]);
  const driversForManualPharmacy = useMemo(() => {
    if (!pharmacyId) return [];
    return drivers.filter((d) => isDriverLinkedToPharmacy(d, pharmacyId));
  }, [drivers, pharmacyId]);

  const driverName = useMemo(() => new Map(drivers.map((d) => [d.id, d.name])), [drivers]);
  const pharmacyName = useMemo(() => new Map(pharmacies.map((p) => [p.id, pharmacyDisplayName(p)])), [pharmacies]);

  const openManualDialog = () => {
    setPharmacyId('');
    setDriverId('');
    setDeliveredAt('');
    setDocumentNumber('');
    setRouteId('');
    setOpen(true);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <BillingField label="Ciclo">
          <FormSelect
            className="mt-1 w-48"
            size="sm"
            value={cycleId}
            onChange={onCycleChange}
            options={[
              { value: '', label: 'Todas (50 por página)' },
              ...cycles.map((c) => ({
                value: c.id,
                label: c.label || `${c.apuracao_start} → ${c.apuracao_end}`,
              })),
            ]}
          />
        </BillingField>
        <BillingField label="Farmácia">
          <FormSelect
            className="mt-1 w-48"
            size="sm"
            value={pharmacyFilter}
            onChange={(value) => {
              setPharmacyFilter(value);
              setPage(1);
            }}
            options={[
              { value: 'todas', label: 'Todas' },
              ...pharmacies.map((p) => ({ value: p.id, label: pharmacyDisplayName(p) })),
            ]}
          />
        </BillingField>
        <BillingField label="Entregador">
          <FormSelect
            className="mt-1 w-48"
            size="sm"
            value={driverFilter}
            onChange={(value) => {
              setDriverFilter(value);
              setPage(1);
            }}
            options={[
              { value: 'todos', label: 'Todos' },
              ...drivers.map((d) => ({ value: d.id, label: cleanBillingLabel(d.name) })),
            ]}
          />
        </BillingField>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => deliveriesQuery.refetch()} disabled={deliveriesQuery.isFetching}>
            <RefreshCw className={cn('mr-1 h-3.5 w-3.5', deliveriesQuery.isFetching && 'animate-spin')} /> Atualizar
          </Button>
          <Button
            size="sm"
            variant="outline"
            title={`Importa entregas da API Flux (${formatBillingSyncRangeLabel(syncRange)})`}
            onClick={() => syncFluxMut.mutate()}
            disabled={syncInFlight}
          >
            <CloudDownload className={cn('mr-1 h-3.5 w-3.5', syncFluxMut.isPending && 'animate-pulse')} />
            {syncFluxMut.isPending ? 'Sincronizando Flux…' : 'Sincronizar Flux (API)'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            title={`Compara e importa faltantes do MySQL Flux (${formatBillingSyncRangeLabel(syncRange)})`}
            onClick={() => syncMysqlMut.mutate()}
            disabled={syncInFlight}
          >
            <Database className={cn('mr-1 h-3.5 w-3.5', syncMysqlMut.isPending && 'animate-pulse')} />
            {syncMysqlMut.isPending ? 'Reconciliando MySQL…' : 'Reconciliar MySQL'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setAtivmobCycleId(cycleId);
              setAtivmobResult(null);
              setAtivmobError(null);
              setAtivmobUnmapped([]);
              setAtivmobUnmappedSummary([]);
              setExcelOpen(true);
            }}
          >
            <Upload className="mr-1 h-3.5 w-3.5" /> Importar Excel
          </Button>
          <Button size="sm" onClick={openManualDialog}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Lançar manual
          </Button>
        </div>
      </div>

      <p className="mb-3 text-[11px] text-muted-foreground">
        <span className="font-medium text-foreground">Atualizar</span> só recarrega a lista.{' '}
        <span className="font-medium text-foreground">Sincronizar</span> busca dados na Flux/MySQL no período{' '}
        <span className="font-mono">{formatBillingSyncRangeLabel(syncRange)}</span>
        {selectedCycle ? ' (ciclo selecionado)' : ' (últimos 7 dias — selecione um ciclo para usar a apuração)'}.
      </p>

      <section className="mb-3 rounded-xl border border-border bg-surface p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            <div>
              <p className="text-xs font-semibold">Notificações de ingestão</p>
              <p className="text-[11px] text-muted-foreground">
                Retornos da planilha, API Flux e MySQL em linguagem operacional.
              </p>
            </div>
          </div>
          {notifications.length ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px]"
              onClick={() => {
                clearBillingDeliveryNotifications();
                setNotifications([]);
              }}
            >
              Limpar
            </Button>
          ) : null}
        </div>
        {notifications.length ? (
          <div className="space-y-2">
            {notifications.slice(0, 4).map((notification) => (
              <div
                key={notification.id}
                className={cn(
                  'rounded-lg border px-3 py-2 text-[11px]',
                  notification.kind === 'error'
                    ? 'border-destructive/25 bg-destructive/10 text-destructive'
                    : notification.kind === 'warning'
                      ? 'border-warning/30 bg-warning/10 text-warning'
                      : 'border-success/25 bg-success/10 text-success'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{notification.title}</p>
                    <p className="mt-0.5 text-foreground">{notification.message}</p>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] opacity-70">
                    {new Date(notification.createdAt).toLocaleString('pt-BR')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Nenhuma notificação recente. Ao importar ou sincronizar entregas, os erros e pendências aparecerão aqui.
          </p>
        )}
      </section>

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
        <div className={billingKpiCompactClassName}>
          <div className={billingKpiLabelClassName}>Total apurado</div>
          <div className="text-lg font-semibold">{totalApurado}</div>
        </div>
        {ORIGEM_KPIS.map((s) => (
          <div key={s} className={billingKpiCompactClassName}>
            <div className={billingKpiLabelClassName}>{deliverySourceBadge(s).label}</div>
            <div className="text-lg font-semibold">{origemKpis[s] ?? 0}</div>
          </div>
        ))}
      </div>
      <p className="mb-2 text-[10px] text-muted-foreground">
        KPIs = entregas verificadas no filtro atual (ciclo/farmácia/entregador). O rodapé conta todas as linhas do
        mesmo filtro, inclusive não verificadas.
      </p>

      <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          Página {page} de {totalPages} · {totalRows} entrega(s)
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            Anterior
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Próxima
          </Button>
        </div>
      </div>

      <div className={billingTableShellClassName}>
        <table className="w-full text-sm">
          <thead className={billingTableHeadClassName}>
            <tr>
              <th className="px-4 py-3">Origem</th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Doc.</th>
              <th className="px-4 py-3">Rota</th>
              <th className="px-4 py-3">Farmácia</th>
              <th className="px-4 py-3">Entregador</th>
              <th className="px-4 py-3">External ID</th>
              <th className="px-4 py-3 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row: BillingDelivery) => {
              const src = deliverySourceBadge(row.source);
              return (
                <tr key={row.id} className="border-b border-border/40 last:border-0">
                  <td className={billingTableCellClassName}>
                    <span className={src.className}>{src.label}</span>
                  </td>
                  <td className={cn(billingTableCellClassName, 'font-mono text-[11px]')}>
                    {new Date(row.delivered_at).toLocaleString('pt-BR')}
                  </td>
                  <td className={cn(billingTableCellClassName, 'text-xs')}>{row.document_number || '—'}</td>
                  <td className={cn(billingTableCellClassName, 'text-xs')}>{row.route_id || '—'}</td>
                  <td className={cn(billingTableCellClassName, 'text-xs')}>
                    <BillingEntityName
                      name={
                        pharmacyDisplayName(row.pharmacies) || pharmacyName.get(row.pharmacy_id) || '—'
                      }
                    />
                  </td>
                  <td className={cn(billingTableCellClassName, 'text-xs')}>
                    <BillingEntityName name={row.drivers?.name || driverName.get(row.driver_id) || '—'} />
                  </td>
                  <td className={cn(billingTableCellClassName, 'font-mono text-[10px] text-muted-foreground')}>
                    {row.external_id}
                  </td>
                  <td className={cn(billingTableCellClassName, 'text-right')}>
                    {row.cancelled ? (
                      <span className="text-[11px] text-destructive">Cancelada</span>
                    ) : row.verified ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-success">
                        <CheckCircle2 className="h-3 w-3" /> Verificada
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px]"
                        onClick={() => verifyMut.mutate(row.id)}
                        disabled={verifyMut.isPending}
                      >
                        Marcar verificada
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!filtered.length && !deliveriesQuery.isLoading ? (
              <tr>
                <td colSpan={8} className="p-4">
                  <BillingEmptyState>
                    Sem entregas neste ciclo — sincronize Flux (as importações novas vinculam ao ciclo aberto) ou escolha “Todas”. Criar ciclo em Acertos.
                  </BillingEmptyState>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <BillingDialogContent
          title="Lançar entrega manual"
          description="Farmácia e entregador são obrigatórios. Informe a quantidade para criar várias entregas de uma vez para o mesmo entregador. Documento, rota e data/hora são opcionais."
          footer={
            <>
              <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                className="flex-1 shadow-md"
                onClick={() => createMut.mutate()}
                disabled={
                  !pharmacyId ||
                  !driverId ||
                  createMut.isPending ||
                  !Number.isFinite(quantity) ||
                  quantity < 1
                }
              >
                {createMut.isPending
                  ? 'Lançando…'
                  : quantity > 1
                    ? `Lançar ${Math.min(500, Math.floor(quantity))} entregas`
                    : 'Lançar'}
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <BillingField label="Farmácia">
              <CadastroSearchCombobox
                entity="pharmacy"
                value={pharmacyId}
                onChange={(next) => {
                  setPharmacyId(next);
                  setDriverId('');
                }}
                className="mt-1"
              />
            </BillingField>
            <BillingField label="Entregador">
              <FormSearchCombobox
                className="mt-1 w-full"
                inputSize="sm"
                value={driverId}
                onChange={setDriverId}
                disabled={!pharmacyId || driversQuery.isLoading}
                placeholder={!pharmacyId ? 'Selecione a farmácia primeiro' : 'Buscar entregador…'}
                emptyLabel={
                  pharmacyId && !driversQuery.isLoading && driversForManualPharmacy.length === 0
                    ? 'Nenhum entregador vinculado a esta farmácia'
                    : 'Nenhum entregador encontrado'
                }
                options={driversForManualPharmacy.map((d) => ({
                  value: d.id,
                  label: cleanBillingLabel(d.name),
                }))}
              />
              {pharmacyId && !driversQuery.isLoading && driversForManualPharmacy.length === 0 ? (
                <p className="mt-1 text-[10px] text-warning">
                  Nenhum entregador ativo vinculado a esta farmácia.
                </p>
              ) : null}
            </BillingField>
            <BillingField label="Quantidade" className="col-span-2">
              <FormControl
                type="number"
                min={1}
                max={500}
                step={1}
                value={quantity}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') {
                    setQuantity(1);
                    return;
                  }
                  const n = Math.floor(Number(raw));
                  if (!Number.isFinite(n)) return;
                  setQuantity(Math.min(500, Math.max(1, n)));
                }}
                className="mt-1 w-full max-w-[12rem] text-xs"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Cria N entregas iguais (mesmo entregador/farmácia). Máx. 500.
              </p>
            </BillingField>
            <BillingField label="Documento (NF) — opcional">
              <FormControl
                value={documentNumber}
                onChange={(e) => setDocumentNumber(e.target.value)}
                placeholder="Opcional"
                className="mt-1 w-full text-xs"
              />
            </BillingField>
            <BillingField label="Rota — opcional">
              <FormControl
                value={routeId}
                onChange={(e) => setRouteId(e.target.value)}
                placeholder="Opcional"
                className="mt-1 w-full text-xs"
              />
            </BillingField>
            <BillingField label="Data/hora — opcional" className="col-span-2">
              <FormControl
                type="datetime-local"
                value={deliveredAt}
                onChange={(e) => setDeliveredAt(e.target.value)}
                className="mt-1 w-full text-xs"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                Se vazio, usa a data/hora atual no lançamento (cada entrega com id externo único).
              </p>
            </BillingField>
            {createMut.isError ? (
              <p className="col-span-2 text-[11px] text-destructive">
                {apiErrorMessage(createMut.error, 'Não foi possível lançar a entrega.')}
              </p>
            ) : null}
          </div>
        </BillingDialogContent>
      </Dialog>

      <Dialog open={excelOpen} onOpenChange={setExcelOpen}>
        <BillingDialogContent
          title="Importar entregas ATIVMOB (Excel)"
          description="Importe planilha no layout ATIVMOB e revise pendências de mapeamento."
          className="sm:max-w-2xl"
          footer={
            <>
              <a
                className={buttonVariants({ variant: 'outline' })}
                href={ATIVMOB_TEMPLATE_URL}
                download
              >
                <Download className="mr-1 h-3.5 w-3.5" /> Modelo Excel
              </a>
              <Button variant="outline" className="flex-1" onClick={() => setExcelOpen(false)}>
                Cancelar
              </Button>
              <Button
                className="flex-1 shadow-md"
                onClick={() => importAtivmobMut.mutate()}
                disabled={!ativmobFile || importAtivmobMut.isPending}
              >
                Importar
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Use um arquivo <strong>.xlsx</strong> no layout ATIVMOB. A importação cruza farmácia por CNPJ e
              entregador por nome/ID Flux.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <BillingField label="Ciclo de faturamento">
                <FormSelect
                  className="mt-1 w-full"
                  size="sm"
                  value={ativmobCycleId}
                  onChange={setAtivmobCycleId}
                  options={[
                    { value: '', label: 'Sem vincular ciclo' },
                    ...cycles.map((c) => ({
                      value: c.id,
                      label: c.label || `${c.apuracao_start} → ${c.apuracao_end}`,
                    })),
                  ]}
                />
              </BillingField>
              <BillingField label="Arquivo Excel">
                <FormControl
                  className="mt-1 w-full text-xs"
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => {
                    setAtivmobFile(e.target.files?.[0] || null);
                    setAtivmobResult(null);
                    setAtivmobError(null);
                    setAtivmobUnmapped([]);
                    setAtivmobUnmappedSummary([]);
                  }}
                />
              </BillingField>
            </div>
            <div className="rounded-md border border-border bg-background/40 p-3 text-[11px] text-muted-foreground">
              Colunas esperadas: <strong>Ambiente</strong>, <strong>CNPJ</strong>, <strong>Nº Sol</strong>,{' '}
              <strong>Código Pedido</strong>, <strong>Despacho</strong>, <strong>Agente</strong>,{' '}
              <strong>Último Status</strong> e <strong>Val. Sol</strong>.
            </div>
            {ativmobResult ? (
              <div className="space-y-2 rounded-md border border-success/20 bg-success/10 p-3 text-[11px] text-success">
                <p className="font-medium">
                  Importadas: {ativmobResult.imported} · Linhas entregues: {ativmobResult.stats.delivered_rows} · Não
                  mapeadas: {ativmobResult.unmapped_count}
                  {(ativmobResult.duplicates_collapsed || ativmobResult.stats.duplicates_collapsed || 0) > 0
                    ? ` · Duplicadas unificadas: ${
                        ativmobResult.duplicates_collapsed || ativmobResult.stats.duplicates_collapsed
                      }`
                    : ''}
                </p>
                {ativmobResult.operator_message ? (
                  <p className="text-[10px]">{ativmobResult.operator_message}</p>
                ) : null}
                <p className="text-[10px]">
                  Linhas lidas: {ativmobResult.stats.total_rows} · Ignoradas por status:{' '}
                  {ativmobResult.stats.skipped_not_delivered ?? 0} · Data inválida:{' '}
                  {ativmobResult.stats.skipped_invalid_dispatch ?? 0} · Sem entregador:{' '}
                  {ativmobResult.stats.skipped_missing_driver ?? 0}
                </p>
                {ativmobResult.unmapped_summary?.length ? (
                  <div className="rounded border border-success/20 bg-background/60 p-2 text-[10px] text-foreground">
                    <p className="mb-1 font-medium">Não importadas por falta de cadastro/mapeamento:</p>
                    <ul className="space-y-1">
                      {ativmobResult.unmapped_summary.slice(0, 8).map((item) => (
                        <li key={`${item.type}-${item.value}`}>
                          {item.type}: {item.value} ({item.count})
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
            {ativmobError ? (
              <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-[11px] text-destructive">
                <p className="font-medium">{ativmobError}</p>
                {ativmobUnmappedSummary.length ? (
                  <ul className="mt-2 space-y-1 text-[10px]">
                    {ativmobUnmappedSummary.slice(0, 8).map((item) => (
                      <li key={`${item.type}-${item.value}`}>
                        {item.type}: {item.value} ({item.count})
                      </li>
                    ))}
                  </ul>
                ) : null}
                {ativmobUnmapped.length ? (
                  <ul className="mt-2 space-y-1 text-[10px]">
                    {ativmobUnmapped.slice(0, 5).map((item, index) => (
                      <li key={`${item.type}-${item.value}-${index}`}>
                        {item.type}: {item.value}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        </BillingDialogContent>
      </Dialog>
    </div>
  );
}
