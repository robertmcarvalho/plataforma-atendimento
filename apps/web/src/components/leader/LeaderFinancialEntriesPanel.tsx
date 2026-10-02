'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Loader2, XCircle } from 'lucide-react';
import { leaderPortalPageApi } from '@/lib/leaderPortal/leaderPortalPageApi';
import {
  leaderOccurrenceTypeLabel,
  leaderStatusTone,
  type LeaderFinancialEntry,
  type LeaderFinancialListParams,
} from '@/lib/leaderPortal/leaderFinancialEntries';
import { formatBRL } from '@/lib/brFormat';
import { formatDateBr } from '@/lib/datetimeBr';
import { cn } from '@/lib/utils';
import { reviveTableHeadRowClassName, reviveTableRowClassName, reviveTableShellClassName } from '@/lib/reviveSurfaces';
import { PaginationControls, DEFAULT_LIST_PAGE_SIZE } from '@/components/ui/PaginationControls';
import { LeaderFinancialEntryDrawer } from '@/components/leader/LeaderFinancialEntryDrawer';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';

const CANCEL_MIN = 10;

type StatusFilter = LeaderFinancialListParams['status_group'];
type OccurrenceFilter = NonNullable<LeaderFinancialListParams['occurrence_type']>;
type DateFieldFilter = NonNullable<LeaderFinancialListParams['date_field']>;

type LeaderFinancialEntriesPanelProps = {
  initialEntryId?: string | null;
  onEntryIdChange?: (entryId: string | null) => void;
};

export function LeaderFinancialEntriesPanel({
  initialEntryId = null,
  onEntryIdChange,
}: LeaderFinancialEntriesPanelProps) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [occurrenceType, setOccurrenceType] = useState<OccurrenceFilter>('all');
  const [dateField, setDateField] = useState<DateFieldFilter>('event');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [pharmacyId, setPharmacyId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [page, setPage] = useState(1);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(initialEntryId);
  const [cancelTarget, setCancelTarget] = useState<LeaderFinancialEntry | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelError, setCancelError] = useState<string | null>(null);

  useEffect(() => {
    if (initialEntryId) setSelectedEntryId(initialEntryId);
  }, [initialEntryId]);

  const pharmaciesQuery = useQuery({
    queryKey: ['leader-portal', 'pharmacies'],
    queryFn: () => leaderPortalPageApi.fetchPharmacies() as Promise<Array<{ id: string; trade_name: string }>>,
  });

  const driversQuery = useQuery({
    queryKey: ['leader-portal', 'drivers'],
    queryFn: () =>
      leaderPortalPageApi.fetchDrivers() as Promise<
        Array<{ id: string; name: string; leader_linked_pharmacy_ids?: string[] }>
      >,
  });

  const driverOptions = useMemo(() => {
    const all = driversQuery.data || [];
    if (!pharmacyId) return all;
    return all.filter((driver) => (driver.leader_linked_pharmacy_ids || []).includes(pharmacyId));
  }, [driversQuery.data, pharmacyId]);

  useEffect(() => {
    if (!driverId || !pharmacyId) return;
    if (!driverOptions.some((driver) => driver.id === driverId)) {
      setDriverId('');
      setPage(1);
    }
  }, [driverId, pharmacyId, driverOptions]);

  const listParams = useMemo<LeaderFinancialListParams>(
    () => ({
      page,
      limit: DEFAULT_LIST_PAGE_SIZE,
      status_group: statusFilter,
      occurrence_type: occurrenceType === 'all' ? undefined : occurrenceType,
      date_field: dateField,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      pharmacy_id: pharmacyId || undefined,
      driver_id: driverId || undefined,
    }),
    [page, statusFilter, occurrenceType, dateField, dateFrom, dateTo, pharmacyId, driverId],
  );

  const entriesQuery = useQuery({
    queryKey: ['leader-portal', 'financial-entries', listParams],
    queryFn: () => leaderPortalPageApi.fetchFinancialEntries(listParams),
  });

  const entries = entriesQuery.data?.entries || [];
  const total = entriesQuery.data?.total ?? 0;

  const cancelMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      leaderPortalPageApi.cancelFinancialEntry(id, reason),
    onSuccess: async () => {
      setCancelTarget(null);
      setCancelReason('');
      setCancelError(null);
      setSelectedEntryId(null);
      onEntryIdChange?.(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['leader-portal', 'financial-entries'] }),
        qc.invalidateQueries({ queryKey: ['leader-portal', 'financial-entry'] }),
        qc.invalidateQueries({ queryKey: ['leader-portal', 'stats'] }),
      ]);
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (err instanceof Error ? err.message : 'Falha ao cancelar');
      setCancelError(msg);
    },
  });

  function openEntry(id: string) {
    setSelectedEntryId(id);
    onEntryIdChange?.(id);
  }

  function closeEntry() {
    setSelectedEntryId(null);
    onEntryIdChange?.(null);
  }

  function resetFilters() {
    setPage(1);
    setOccurrenceType('all');
    setDateField('event');
    setDateFrom('');
    setDateTo('');
    setPharmacyId('');
    setDriverId('');
  }

  return (
    <section className="mt-8 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Acompanhar lançamentos</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Clique em uma linha para ver o detalhe. Valor e data prevista de PIX já aparecem antes da aprovação.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['open', 'Em aberto'],
              ['all', 'Todos'],
              ['done', 'Pagos'],
              ['cancelled', 'Cancelados / rejeitados'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setStatusFilter(value);
                setPage(1);
              }}
              className={cn(
                'rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors',
                statusFilter === value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-surface text-muted-foreground hover:bg-muted/40',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-border bg-card/40 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Tipo</label>
          <FormSelect
            value={occurrenceType}
            onChange={(value) => {
              setOccurrenceType(value as OccurrenceFilter);
              setPage(1);
            }}
            className="mt-1"
            options={[
              { value: 'all', label: 'Todos os tipos' },
              { value: 'unexcused', label: 'Falta' },
              { value: 'day_off', label: 'Folga' },
              { value: 'coverage_daily', label: 'Diária de cobertura' },
              { value: 'contracted_daily', label: 'Diária contratada' },
            ]}
          />
        </div>
        <div>
          <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Filtrar data por</label>
          <FormSelect
            value={dateField}
            onChange={(value) => {
              setDateField(value as DateFieldFilter);
              setPage(1);
            }}
            className="mt-1"
            options={[
              { value: 'event', label: 'Data do evento' },
              { value: 'created', label: 'Enviado em' },
            ]}
          />
        </div>
        <div>
          <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">De</label>
          <FormControl
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            className="mt-1"
          />
        </div>
        <div>
          <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Até</label>
          <FormControl
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            className="mt-1"
          />
        </div>
        <div>
          <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Farmácia</label>
          <FormSelect
            value={pharmacyId}
            onChange={(value) => {
              setPharmacyId(value);
              setDriverId('');
              setPage(1);
            }}
            className="mt-1"
            options={[
              { value: '', label: 'Todas' },
              ...(pharmaciesQuery.data || []).map((p) => ({ value: p.id, label: p.trade_name })),
            ]}
          />
        </div>
        <div>
          <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Entregador</label>
          <FormSelect
            value={driverId}
            onChange={(value) => {
              setDriverId(value);
              setPage(1);
            }}
            className="mt-1"
            options={[
              { value: '', label: 'Todos' },
              ...driverOptions.map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
        </div>
        <div className="flex items-end sm:col-span-2">
          <button
            type="button"
            onClick={resetFilters}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Limpar filtros
          </button>
        </div>
      </div>

      <div className={reviveTableShellClassName}>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className={reviveTableHeadRowClassName}>
                <th className="px-3 py-2.5">Tipo</th>
                <th className="px-3 py-2.5">Entregador</th>
                <th className="px-3 py-2.5">Farmácia</th>
                <th className="px-3 py-2.5">Evento</th>
                <th className="px-3 py-2.5 text-right">Valor</th>
                <th className="px-3 py-2.5">PIX previsto</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {entriesQuery.isLoading ? (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    Nenhum lançamento neste filtro.
                  </td>
                </tr>
              ) : (
                entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className={cn(reviveTableRowClassName, 'cursor-pointer hover:bg-muted/30')}
                    onClick={() => openEntry(entry.id)}
                  >
                    <td className="px-3 py-2.5 text-xs font-medium">{leaderOccurrenceTypeLabel(entry)}</td>
                    <td className="px-3 py-2.5 text-sm">{entry.driver?.name || '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{entry.pharmacy?.trade_name || '—'}</td>
                    <td className="px-3 py-2.5 text-xs font-mono">
                      {entry.event_date ? formatDateBr(entry.event_date) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-sm">{formatBRL(entry.amount)}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {entry.payment_date ? (
                        <span title={entry.payment_date}>
                          {format(parseISO(entry.payment_date), 'dd/MM/yyyy (EEEE)', { locale: ptBR })}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={cn(
                          'inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold',
                          leaderStatusTone(entry.leader_status),
                        )}
                      >
                        {entry.leader_status_label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                      {entry.can_cancel ? (
                        <button
                          type="button"
                          onClick={() => {
                            setCancelTarget(entry);
                            setCancelReason('');
                            setCancelError(null);
                          }}
                          className="inline-flex items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive hover:bg-destructive/15"
                        >
                          <XCircle className="h-3 w-3" />
                          Cancelar
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-3 pb-3">
          <PaginationControls
            page={page}
            pageSize={DEFAULT_LIST_PAGE_SIZE}
            totalItems={total}
            onPageChange={setPage}
            itemLabel="lançamentos"
          />
        </div>
      </div>

      <LeaderFinancialEntryDrawer
        entryId={selectedEntryId}
        onClose={closeEntry}
        onOpenEntry={openEntry}
      />

      {cancelTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-lg">
            <h3 className="text-sm font-semibold">Cancelar lançamento</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {leaderOccurrenceTypeLabel(cancelTarget)} — {cancelTarget.driver?.name || 'entregador'} (
              {formatBRL(cancelTarget.amount)}). Esta ação não pode ser desfeita.
              {cancelTarget.type === 'daily' && cancelTarget.coverage_of_entry_id
                ? ' A falta vinculada também será cancelada.'
                : null}
            </p>
            <label className="mt-4 block text-xs font-medium text-muted-foreground">
              Motivo do cancelamento (obrigatório)
            </label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Descreva o erro ou motivo do cancelamento…"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">Mínimo {CANCEL_MIN} caracteres.</p>
            {cancelError ? <p className="mt-2 text-xs text-destructive">{cancelError}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium"
                disabled={cancelMutation.isPending}
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={cancelMutation.isPending || cancelReason.trim().length < CANCEL_MIN}
                onClick={() => cancelMutation.mutate({ id: cancelTarget.id, reason: cancelReason.trim() })}
                className="rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground disabled:opacity-50"
              >
                {cancelMutation.isPending ? 'Cancelando…' : 'Confirmar cancelamento'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
