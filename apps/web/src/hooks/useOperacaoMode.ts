'use client';

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import type { OperacaoMode } from '@/lib/operacao/operacaoMode';
import { useAuth } from '@/store/auth';

type OperacaoModeResponse = {
  mode: OperacaoMode;
  modes?: OperacaoMode[];
  roles?: string[];
  sector_names: string[];
  portfolio_pharmacy_count?: number;
};

export function useOperacaoMode(): {
  mode: OperacaoMode;
  modes: OperacaoMode[];
  roles: string[];
  sectorNames: string[];
  portfolioPharmacyCount: number;
  isLoading: boolean;
} {
  const user = useAuth((s) => s.user);

  const modeQuery = useQuery({
    queryKey: ['ops-analytics', 'operacao-mode', user?.id, user?.workspace_id],
    enabled: Boolean(user?.id),
    queryFn: async () => (await api.get<OperacaoModeResponse>('/api/ops-analytics/operacao-mode')).data,
    staleTime: 60_000,
  });

  const mode = modeQuery.data?.mode || 'indisponivel';
  const modes =
    modeQuery.data?.modes?.length ? modeQuery.data.modes : mode !== 'indisponivel' ? [mode] : [];

  return {
    mode,
    modes,
    roles: modeQuery.data?.roles || user?.workspace_roles || [],
    sectorNames: modeQuery.data?.sector_names || [],
    portfolioPharmacyCount: modeQuery.data?.portfolio_pharmacy_count ?? 0,
    isLoading: modeQuery.isLoading && !modeQuery.data,
  };
}
