// WIP � feature paused. Flag: ticketingPanel in lib/features.ts
// Do not delete. Context: codebase audit Phase A (ticketing panel soft-pause)

'use client';

import { useQuery } from '@tanstack/react-query';
import { SectionTitle } from '@/components/ui/SectionTitle';
import api from '@/lib/api';
import { formatCentsBRL } from '@/lib/pharmacyCommercial';
import { formatWorkScheduleSummary, hasConfiguredWorkSchedule } from '@/components/settings/BusinessHoursEditor';

type PharmacyDetail = {
  id?: string;
  trade_name?: string | null;
  city?: string | null;
  state?: string | null;
  delivery_fee_cents?: number | null;
  delivery_fee_driver_payout_cents?: number | null;
  minimum_guaranteed_cents?: number | null;
  minimum_guaranteed_driver_payout_cents?: number | null;
  delivery_schedule?: Record<string, unknown> | null;
  delivery_schedule_summary?: string;
  delivery_open_now?: boolean | null;
  commercial_terms?: string[];
};

type DriverDetail = {
  id: string;
  primary_pharmacy_id?: string | null;
  primary_pharmacy?: {
    id?: string;
    trade_name?: string | null;
    city?: string | null;
  } | null;
};

export function PharmacyContextCard({ pharmacyId, driverId }: { pharmacyId: string | null; driverId: string | null }) {
  const driverQ = useQuery({
    queryKey: ['driver-context', driverId],
    enabled: !pharmacyId && Boolean(driverId),
    queryFn: async () => {
      const r = await api.get(`/api/drivers/${driverId}`);
      return r.data as DriverDetail;
    },
  });

  const resolvedPharmacyId = pharmacyId || driverQ.data?.primary_pharmacy_id || driverQ.data?.primary_pharmacy?.id || null;

  const q = useQuery({
    queryKey: ['pharmacy', resolvedPharmacyId],
    enabled: Boolean(resolvedPharmacyId),
    queryFn: async () => {
      const r = await api.get(`/api/pharmacies/${resolvedPharmacyId}`);
      return r.data as PharmacyDetail;
    },
  });

  if (!pharmacyId && !driverId) {
    return (
      <div className="rounded-lg border border-border bg-transparent p-3">
        <SectionTitle>Farmácia</SectionTitle>
        <p className="mt-1 text-xs text-muted-foreground">Sem farmácia vinculada.</p>
      </div>
    );
  }

  if (driverQ.isLoading || q.isLoading) {
    return (
      <div className="rounded-lg border border-border bg-transparent p-3">
        <SectionTitle>Farmácia</SectionTitle>
        <p className="mt-1 text-xs text-muted-foreground">Carregando…</p>
      </div>
    );
  }

  if (driverQ.isError || q.isError) {
    return (
      <div className="rounded-lg border border-border bg-transparent p-3">
        <SectionTitle>Farmácia</SectionTitle>
        <p className="mt-1 text-xs text-destructive">Não foi possível carregar a farmácia.</p>
      </div>
    );
  }

  if (!resolvedPharmacyId || !q.data) {
    return (
      <div className="rounded-lg border border-border bg-transparent p-3">
        <SectionTitle>Farmácia</SectionTitle>
        <p className="mt-1 text-xs text-muted-foreground">Sem farmácia vinculada.</p>
      </div>
    );
  }

  const p = q.data;
  const cityLine = [p.city, p.state].filter(Boolean).join(' / ') || '—';
  const hasFee = p.delivery_fee_cents != null;
  const scheduleSummary =
    p.delivery_schedule_summary ||
    (hasConfiguredWorkSchedule(p.delivery_schedule) ? formatWorkScheduleSummary(p.delivery_schedule) : '');

  return (
    <div className="rounded-lg border border-border bg-transparent p-3">
      <SectionTitle>Farmácia</SectionTitle>
      <div className="mt-1 text-sm font-semibold text-foreground">{p.trade_name || '—'}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{cityLine}</div>
      {hasFee ? (
        <div className="mt-2 text-xs text-muted-foreground">
          Taxa entrega: {formatCentsBRL(p.delivery_fee_cents)}
          {p.delivery_fee_driver_payout_cents != null ? (
            <span> · Repasse: {formatCentsBRL(p.delivery_fee_driver_payout_cents)}</span>
          ) : null}
        </div>
      ) : null}
      {p.minimum_guaranteed_cents != null ? (
        <div className="mt-1 text-xs text-muted-foreground">
          Mín. garantido: {formatCentsBRL(p.minimum_guaranteed_cents)}
        </div>
      ) : null}
      {scheduleSummary ? (
        <div className="mt-2 text-xs text-muted-foreground">
          <span className="font-medium text-subtle-foreground">Delivery: </span>
          {scheduleSummary}
        </div>
      ) : null}
      {p.delivery_open_now != null ? (
        <div className="mt-1 text-xs font-medium text-foreground">
          Agora: {p.delivery_open_now ? 'aberto' : 'fechado'}
        </div>
      ) : null}
    </div>
  );
}
