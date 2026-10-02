import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchBillingStatus, fetchCostCenters } from './billingApi';
import { isBillingModuleEnabled, setBillingModuleEnabledCache } from './billingAccess';

export function useBillingModuleStatus(enabled = true) {
  return useQuery({
    queryKey: ['billing', 'status'],
    queryFn: fetchBillingStatus,
    staleTime: 60_000,
    enabled,
  });
}

/** Status reativo (API + cache) para menu lateral e telas de cadastro. */
export function useBillingModuleEnabled(userAuthenticated = true): boolean {
  const { data } = useBillingModuleStatus(userAuthenticated);
  useEffect(() => {
    if (data?.enabled !== undefined) setBillingModuleEnabledCache(data.enabled);
  }, [data?.enabled]);
  if (data?.enabled !== undefined) return data.enabled;
  return isBillingModuleEnabled();
}

export function useBillingCostCenters(activeOnly = false) {
  return useQuery({
    queryKey: ['billing', 'cost-centers', activeOnly ? 'active' : 'all'],
    queryFn: () => fetchCostCenters(activeOnly),
  });
}
