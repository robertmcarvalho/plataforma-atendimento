// WIP � feature paused. Flag: ticketingPanel in lib/features.ts
// Do not delete. Context: codebase audit Phase A (ticketing panel soft-pause)

'use client';

import { useQuery } from '@tanstack/react-query';
import { SectionTitle } from '@/components/ui/SectionTitle';
import api from '@/lib/api';

type LeaderRow = {
  id?: string;
  name?: string | null;
};

type PharmacyWithLeader = {
  leader?: LeaderRow | null;
};

export function LeaderContextCard({
  pharmacyId,
  leaderEntityId,
  driverId,
}: {
  pharmacyId: string | null;
  leaderEntityId: string | null;
  driverId: string | null;
}) {
  const driverQ = useQuery({
    queryKey: ['driver-context', driverId],
    enabled: !pharmacyId && Boolean(driverId),
    queryFn: async () => {
      const r = await api.get(`/api/drivers/${driverId}`);
      return r.data as { primary_pharmacy_id?: string | null };
    },
  });

  const resolvedPharmacyId = pharmacyId || driverQ.data?.primary_pharmacy_id || null;

  const pharmacyQ = useQuery({
    queryKey: ['pharmacy', resolvedPharmacyId],
    enabled: Boolean(resolvedPharmacyId),
    queryFn: async () => {
      const r = await api.get(`/api/pharmacies/${resolvedPharmacyId}`);
      return r.data as PharmacyWithLeader;
    },
  });

  const leaderFromPharmacy = pharmacyQ.data?.leader;

  const leaderFallbackQ = useQuery({
    queryKey: ['leader', leaderEntityId],
    enabled:
      Boolean(leaderEntityId) &&
      (!resolvedPharmacyId || (pharmacyQ.isFetched && !leaderFromPharmacy?.name)),
    queryFn: async () => {
      const r = await api.get(`/api/leaders/${leaderEntityId}`);
      return r.data as LeaderRow;
    },
  });

  const leader = leaderFromPharmacy?.name ? leaderFromPharmacy : leaderFallbackQ.data;

  const loading =
    (Boolean(driverId) && !pharmacyId && driverQ.isLoading) ||
    (Boolean(resolvedPharmacyId) && pharmacyQ.isLoading) ||
    (Boolean(leaderEntityId) && (!resolvedPharmacyId || (pharmacyQ.isFetched && !leaderFromPharmacy?.name)) && leaderFallbackQ.isLoading);

  const error =
    (Boolean(resolvedPharmacyId) && pharmacyQ.isError) ||
    (Boolean(leaderEntityId) && leaderFallbackQ.isError && !leaderFromPharmacy?.name);

  if (!pharmacyId && !leaderEntityId && !driverId) {
    return (
      <div className="rounded-lg border border-border bg-transparent p-3">
        <SectionTitle>Líder responsável</SectionTitle>
        <p className="mt-1 text-xs text-muted-foreground">Sem líder vinculado ao contexto atual.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-transparent p-3">
        <SectionTitle>Líder responsável</SectionTitle>
        <p className="mt-1 text-xs text-muted-foreground">Carregando…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-transparent p-3">
        <SectionTitle>Líder responsável</SectionTitle>
        <p className="mt-1 text-xs text-destructive">Falha ao carregar dados de líder.</p>
      </div>
    );
  }

  if (!leader?.name) {
    return (
      <div className="rounded-lg border border-border bg-transparent p-3">
        <SectionTitle>Líder responsável</SectionTitle>
        <p className="mt-1 text-xs text-muted-foreground">Sem dados de líder disponíveis.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-transparent p-3">
      <SectionTitle>Líder responsável</SectionTitle>
      <div className="mt-1 text-sm font-semibold text-foreground">{leader.name}</div>
    </div>
  );
}
