'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, UserRound } from 'lucide-react';
import { InboxPanelCard } from '@/components/inbox/InboxPanelCard';
import api from '@/lib/api';
import type { ApiConversationDetail } from '@/lib/inbox/types';
import type { ContactDetail } from '@/types/contact';

type DriverLink = {
  id?: string;
  is_active?: boolean;
  pharmacies?: { trade_name?: string | null } | null;
};

function resolveDriverId(detail?: ApiConversationDetail, contact?: ContactDetail): string | null {
  return detail?.context_driver?.id || contact?.driver?.id || contact?.driver_id || null;
}

function isDriverContext(detail?: ApiConversationDetail, contact?: ContactDetail): boolean {
  if (detail?.context_driver?.id) return true;
  if (contact?.profile_type === 'driver') return true;
  return Boolean(contact?.driver_id || contact?.driver?.id);
}

export function InboxDriverVinculoSection({
  detail,
  contact,
}: {
  detail?: ApiConversationDetail;
  contact?: ContactDetail;
}) {
  const driverId = resolveDriverId(detail, contact);
  const show = isDriverContext(detail, contact) && Boolean(driverId);

  const driverQ = useQuery({
    queryKey: ['inbox', 'driver-vinculo', driverId],
    enabled: show && Boolean(driverId),
    queryFn: () => api.get(`/api/drivers/${driverId}`).then((r) => r.data as Record<string, unknown>),
    staleTime: 30_000,
  });

  if (!show || !driverId) return null;

  const links = (
    Array.isArray(driverQ.data?.driver_pharmacy_links)
      ? (driverQ.data!.driver_pharmacy_links as DriverLink[])
      : []
  ).filter((link) => Boolean(link.is_active));

  const pharmacyNames = links
    .map((link) => String(link.pharmacies?.trade_name || '').trim())
    .filter(Boolean);

  const overrideLeader = driverQ.data?.override_leader as { name?: string } | undefined;
  const pharmacyLeader = (driverQ.data?.primary_pharmacy as { leader?: { name?: string } } | undefined)?.leader;
  const leaderName = String(overrideLeader?.name || pharmacyLeader?.name || '').trim();
  const driverName =
    String(driverQ.data?.name || detail?.context_driver?.name || '').trim() ||
    String(contact?.driver?.name || '').trim();

  return (
    <div className="border-b border-border px-4 py-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-subtle-foreground">Vínculo</h4>

      {driverQ.isLoading ? (
        <div className="space-y-3">
          <div className="h-[5.5rem] animate-pulse rounded-xl border border-border bg-muted/30" />
          <div className="h-[4.5rem] animate-pulse rounded-xl border border-border bg-muted/30" />
        </div>
      ) : driverQ.isError ? (
        <p className="text-xs text-muted-foreground">Não foi possível carregar os vínculos.</p>
      ) : (
        <div className="space-y-3">
          {driverName ? (
            <InboxPanelCard
              icon={<UserRound className="h-3.5 w-3.5 shrink-0 text-foreground/70" aria-hidden />}
              title="Entregador"
              badgeLabel="Identificado"
              badgeTone="success"
              metaPrimary={driverName}
            />
          ) : null}
          <InboxPanelCard
            icon={<Building2 className="h-3.5 w-3.5 shrink-0 text-foreground/70" aria-hidden />}
            title="Farmácias"
            badgeLabel={links.length > 0 ? `${links.length} ativa${links.length === 1 ? '' : 's'}` : 'Sem vínculo'}
            badgeTone={links.length > 0 ? 'success' : 'neutral'}
            metaPrimary={pharmacyNames.length > 0 ? `${pharmacyNames.length} unidade${pharmacyNames.length === 1 ? '' : 's'} vinculada${pharmacyNames.length === 1 ? '' : 's'}` : 'Nenhuma farmácia vinculada'}
            metaSecondary={pharmacyNames[0] ? pharmacyNames[0] : undefined}
            metaLines={pharmacyNames.length > 1 ? pharmacyNames.slice(1) : pharmacyNames.length === 0 ? ['Cadastre o vínculo na ficha do entregador.'] : undefined}
          />

          <InboxPanelCard
            icon={<UserRound className="h-3.5 w-3.5 shrink-0 text-foreground/70" aria-hidden />}
            title="Líder responsável"
            badgeLabel={leaderName ? 'Vinculado' : 'Pendente'}
            badgeTone={leaderName ? 'success' : 'neutral'}
            metaPrimary="Responsável operacional"
            metaSecondary={leaderName || 'Não informado no cadastro'}
          />
        </div>
      )}
    </div>
  );
}
