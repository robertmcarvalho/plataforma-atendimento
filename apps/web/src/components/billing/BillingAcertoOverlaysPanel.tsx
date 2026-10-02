'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { BrCentsInput } from '@/components/form/BrCentsInput';
import {
  fetchPharmacyDayBaseDays,
  fetchPharmacyMgOverlays,
  upsertPharmacyDayBaseDay,
  upsertPharmacyMgOverlay,
} from '@/lib/billing/billingApi';
import { formatBrlCents } from '@/lib/billing/billingFormat';
import { apiErrorMessage } from '@/lib/apiErrorMessage';

type DriverOption = { id: string; name: string };

export function BillingAcertoOverlaysPanel({
  cycleId,
  pharmacyId,
  drivers,
  defaultDayBaseCents,
  dayBaseEnabled,
  canManage,
}: {
  cycleId: string;
  pharmacyId: string;
  drivers: DriverOption[];
  defaultDayBaseCents: number;
  dayBaseEnabled: boolean;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const [driverId, setDriverId] = useState(drivers[0]?.id || '');
  const [eventDate, setEventDate] = useState('');
  const [amountCents, setAmountCents] = useState<number | null>(defaultDayBaseCents);
  const [multiplier, setMultiplier] = useState<'0.5' | '1' | '2'>('1');
  const [justification, setJustification] = useState('');

  const dayBaseQuery = useQuery({
    queryKey: ['billing', 'day-base-days', cycleId, pharmacyId],
    queryFn: () => fetchPharmacyDayBaseDays(cycleId, pharmacyId),
  });
  const mgQuery = useQuery({
    queryKey: ['billing', 'mg-overlays', cycleId, pharmacyId],
    queryFn: () => fetchPharmacyMgOverlays(cycleId, pharmacyId),
  });

  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['billing', 'day-base-days', cycleId, pharmacyId] }),
      qc.invalidateQueries({ queryKey: ['billing', 'mg-overlays', cycleId, pharmacyId] }),
      qc.invalidateQueries({ queryKey: ['billing', 'settlements'] }),
    ]);
  };

  const dayBaseMut = useMutation({
    mutationFn: () =>
      upsertPharmacyDayBaseDay(cycleId, pharmacyId, {
        driver_id: driverId,
        event_date: eventDate,
        amount_cents: amountCents ?? defaultDayBaseCents,
        active: true,
      }),
    onSuccess: invalidate,
  });

  const mgMut = useMutation({
    mutationFn: () =>
      upsertPharmacyMgOverlay(cycleId, pharmacyId, {
        driver_id: driverId,
        multiplier: Number(multiplier) as 0.5 | 1 | 2,
        justification,
      }),
    onSuccess: () => {
      setJustification('');
      return invalidate();
    },
  });

  const driverOptions = useMemo(
    () => drivers.map((d) => ({ value: d.id, label: d.name })),
    [drivers]
  );

  if (!drivers.length) return null;

  return (
    <div className="mb-4 space-y-3 rounded-md border border-border bg-muted/20 px-4 py-3">
      <div>
        <p className="text-sm font-medium">Ajustes do ciclo (preservados no recálculo)</p>
        <p className="text-xs text-muted-foreground">
          Diária-base: fatura usa o valor do cadastro da farmácia; o valor abaixo é o repasse ao entregador (quinta).
          Multiplicador de MG altera só o repasse.
        </p>
      </div>

      {(dayBaseQuery.data || []).length || (mgQuery.data || []).length ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {(dayBaseQuery.data || []).map((row) => {
            const driverName = drivers.find((d) => d.id === row.driverId)?.name || row.driverId;
            return (
              <li key={row.id}>
                Diária-base · {driverName} · {row.eventDate.slice(8, 10)}/{row.eventDate.slice(5, 7)} · cobrado{' '}
                {formatBrlCents(defaultDayBaseCents)} · repasse {formatBrlCents(row.amountCents)}
              </li>
            );
          })}
          {(mgQuery.data || []).map((row) => {
            const driverName = drivers.find((d) => d.id === row.driverId)?.name || row.driverId;
            return (
              <li key={row.id}>
                MG ×{row.multiplier} (só repasse) · {driverName} · {row.justification}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhum overlay neste ciclo ainda.</p>
      )}

      {canManage ? (
        <div className="grid gap-2 md:grid-cols-2">
          <div className="space-y-2 rounded-md border border-border/60 bg-background/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Diária-base</p>
            {!dayBaseEnabled ? (
              <p className="text-xs text-warning">Ative a diária-base no cadastro da farmácia para usar o valor padrão.</p>
            ) : null}
            <FormSelect
              value={driverId}
              onChange={setDriverId}
              options={driverOptions}
            />
            <FormControl type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Cobrança farmácia (cadastro): {formatBrlCents(defaultDayBaseCents)}
            </p>
            <label className="block text-xs text-muted-foreground">Repasse ao entregador (R$)</label>
            <BrCentsInput value={amountCents} onChange={setAmountCents} />
            <Button
              size="sm"
              variant="outline"
              disabled={!driverId || !eventDate || dayBaseMut.isPending}
              onClick={() => dayBaseMut.mutate()}
            >
              Confirmar dia
            </Button>
            {dayBaseMut.isError ? (
              <p className="text-xs text-destructive">{apiErrorMessage(dayBaseMut.error, 'Falha ao salvar.')}</p>
            ) : null}
          </div>

          <div className="space-y-2 rounded-md border border-border/60 bg-background/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Multiplicador MG</p>
            <FormSelect value={driverId} onChange={setDriverId} options={driverOptions} />
            <FormSelect
              value={multiplier}
              onChange={(v) => setMultiplier(v as '0.5' | '1' | '2')}
              options={[
                { value: '0.5', label: 'Meio período (0,5)' },
                { value: '1', label: 'Normal (1)' },
                { value: '2', label: 'Dois períodos (2) — só repasse' },
              ]}
            />
            <FormControl
              placeholder="Justificativa"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!driverId || justification.trim().length < 3 || mgMut.isPending}
              onClick={() => mgMut.mutate()}
            >
              Aplicar multiplicador
            </Button>
            {mgMut.isError ? (
              <p className="text-xs text-destructive">{apiErrorMessage(mgMut.error, 'Falha ao salvar.')}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
