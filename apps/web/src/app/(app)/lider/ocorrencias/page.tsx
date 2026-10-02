'use client';

import { leaderPortalPageApi } from '@/lib/leaderPortal/leaderPortalPageApi';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ClipboardList } from 'lucide-react';
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LeaderPage } from '@/components/leader/LeaderPage';
import { PageHeader } from '@/components/ui/PageHeader';
import { buttonVariants } from '@/components/ui/button';
import { OccurrenceWizard } from '@/components/occurrences/OccurrenceWizard';
import { LeaderFinancialEntriesPanel } from '@/components/leader/LeaderFinancialEntriesPanel';
import { useAuth } from '@/store/auth';
import { LEADER_OCCURRENCES_PATH } from '@/lib/leaderPortal/leaderOccurrencesPath';

type Driver = {
  id: string;
  name: string;
  primary_pharmacy_id: string | null;
  leader_linked_pharmacy_ids?: string[];
};
type Pharmacy = { id: string; trade_name: string };

export default function LiderOcorrenciasPage() {
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const entryIdFromUrl = searchParams.get('entry_id');

  const driversQuery = useQuery<Driver[]>({
    queryKey: ['leader-portal', 'drivers'],
    queryFn: async () => await leaderPortalPageApi.fetchDrivers() as Driver[],
    enabled: user?.role === 'leader',
  });

  const pharmaciesQuery = useQuery<Pharmacy[]>({
    queryKey: ['leader-portal', 'pharmacies'],
    queryFn: async () => await leaderPortalPageApi.fetchPharmacies() as Pharmacy[],
    enabled: user?.role === 'leader',
  });

  const handleEntryIdChange = useCallback(
    (entryId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (entryId) {
        params.set('entry_id', entryId);
      } else {
        params.delete('entry_id');
      }
      const qs = params.toString();
      router.replace(qs ? `${LEADER_OCCURRENCES_PATH}?${qs}` : LEADER_OCCURRENCES_PATH, { scroll: false });
    },
    [router, searchParams],
  );

  if (user && user.role !== 'leader') {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <PageHeader
          eyebrow="Acesso"
          title="Ocorrências e lançamentos"
          description="Esta área é exclusiva para perfis de líder."
          compact
        />
        <Link className={buttonVariants({ variant: 'secondary' })} href="/dashboard">
          Voltar
        </Link>
      </div>
    );
  }

  return (
    <LeaderPage>
      <PageHeader
        icon={ClipboardList}
        eyebrow="Operação"
        title="Ocorrências e lançamentos"
        description="Registre falta, folga ou diária e acompanhe o status até a baixa no financeiro."
      />

      <OccurrenceWizard
        mode="leader"
        drivers={driversQuery.data || []}
        pharmacies={pharmaciesQuery.data || []}
        driversLoading={driversQuery.isLoading}
        pharmaciesLoading={pharmaciesQuery.isLoading}
        onSuccess={() => {
          void qc.invalidateQueries({ queryKey: ['leader-portal', 'stats'] });
          void qc.invalidateQueries({ queryKey: ['leader-portal', 'financial-entries'] });
        }}
        layout="embedded"
      />

      <LeaderFinancialEntriesPanel
        initialEntryId={entryIdFromUrl}
        onEntryIdChange={handleEntryIdChange}
      />
    </LeaderPage>
  );
}
