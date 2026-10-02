import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import api from '@/lib/api';
import { matchesConferenceDate, conferenceWeekdayUiFromRef } from '@/lib/financialCycle';
import { isPayableFinancialEntryStatus } from '@/lib/financial/financialEntryStatus';
import { buildTypeLabels } from '@/lib/financial/financialLabels';
import { buildCoverageMaps } from '@/lib/financial/financialCoverage';
import { DEFAULT_DISCOUNT_RULES } from '@/lib/financial/financialDiscountRules';
import {
  matchesInstallmentSettlementFilter,
  installmentsOnReferenceDate,
  isOpenInstallmentStatus,
} from '@/lib/financial/financialInstallments';
import type { ApiEntry, EntryTypesCtx, InstallmentSettlementFilter } from '@/lib/financial/types';
import type { DiscountRule } from '@/lib/financialCycle';

type SummaryInput = {
  statusFilter: string;
  typeFilter: string;
  leaderFilter: string;
  pharmacyFilter: string;
  driverFilter: string;
  installmentFilter: InstallmentSettlementFilter;
  search: string;
  showOccurrence: boolean;
  canRegisterOccurrence: boolean;
};

export function useFinancialSummary(input: SummaryInput) {
  const {
    statusFilter,
    typeFilter,
    leaderFilter,
    pharmacyFilter,
    driverFilter,
    installmentFilter,
    search,
    showOccurrence,
    canRegisterOccurrence,
  } = input;

  const [discountRules, setDiscountRules] = useState<Record<string, DiscountRule>>(() => {
    if (typeof window === 'undefined') return DEFAULT_DISCOUNT_RULES;
    try {
      const saved = window.localStorage.getItem('financial-discount-rules');
      return saved ? { ...DEFAULT_DISCOUNT_RULES, ...JSON.parse(saved) } : DEFAULT_DISCOUNT_RULES;
    } catch {
      return DEFAULT_DISCOUNT_RULES;
    }
  });

  const currentCycleStart = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const [selectedCycleStart, setSelectedCycleStart] = useState<string>(currentCycleStart);

  const { data: discountRulesPayload } = useQuery({
    queryKey: ['financial-discount-rules'],
    queryFn: () => api.get('/api/financial/discount-rules').then((r) => r.data as { rules: Record<string, DiscountRule> }),
    retry: 1,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (discountRulesPayload?.rules && typeof discountRulesPayload.rules === 'object') {
      setDiscountRules({ ...DEFAULT_DISCOUNT_RULES, ...discountRulesPayload.rules });
    }
  }, [discountRulesPayload]);

  const { data: entryTypesPayload } = useQuery({
    queryKey: ['financial-entry-types'],
    queryFn: () => api.get('/api/financial/entry-types').then((r) => r.data as { types: EntryTypesCtx['types'] }),
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const entryTypesCtx = useMemo<EntryTypesCtx>(() => {
    const list = entryTypesPayload?.types ?? [];
    return { types: list, labels: buildTypeLabels(list) };
  }, [entryTypesPayload]);

  const { data: leadersList } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['leaders-financial-filter'],
    queryFn: () => api.get('/api/leaders', { params: { status: 'active' } }).then((r) => r.data),
  });

  const { data: pharmaciesList } = useQuery<Array<{ id: string; trade_name: string }>>({
    queryKey: ['pharmacies-financial-filter'],
    queryFn: () => api.get('/api/pharmacies', { params: { status: 'active' } }).then((r) => r.data),
  });

  const { data: occurrenceDrivers, isLoading: occurrenceDriversLoading } = useQuery<
    Array<{
      id: string;
      name: string;
      primary_pharmacy_id?: string | null;
      leader_linked_pharmacy_ids?: string[];
      driver_pharmacy_links?: Array<{ is_active?: boolean; pharmacies?: { id: string } | null }>;
    }>
  >({
    queryKey: ['financial-occurrence-drivers'],
    queryFn: () => api.get('/api/drivers', { params: { status: 'active' } }).then((r) => r.data),
    enabled: showOccurrence && canRegisterOccurrence,
  });

  const conferenceWeekdayUi = useMemo(
    () => conferenceWeekdayUiFromRef(selectedCycleStart, discountRules),
    [selectedCycleStart, discountRules]
  );

  const {
    data: entriesData,
    isLoading,
    refetch,
    isFetching,
  } = useQuery<ApiEntry[]>({
    queryKey: [
      'financial-entries',
      statusFilter,
      typeFilter,
      leaderFilter,
      pharmacyFilter,
      driverFilter,
      installmentFilter,
      selectedCycleStart,
      conferenceWeekdayUi,
    ],
    queryFn: () => {
      const params: Record<string, string> = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      if (typeFilter !== 'all') params.type = typeFilter;
      if (leaderFilter) params.leader_id = leaderFilter;
      if (pharmacyFilter) params.pharmacy_id = pharmacyFilter;
      if (driverFilter) params.driver_id = driverFilter;
      if (!driverFilter && conferenceWeekdayUi !== null) {
        params.due_date = selectedCycleStart;
        if (installmentFilter !== 'all') params.installment_status = installmentFilter;
      }
      return api.get('/api/financial/entries', { params }).then((r) => r.data);
    },
  });

  const entries = useMemo(() => entriesData || [], [entriesData]);
  const coverageMaps = useMemo(() => buildCoverageMaps(entries), [entries]);

  const finalFiltered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const bySearch = (list: ApiEntry[]) =>
      !needle
        ? list
        : list.filter((entry) =>
            `${entry.drivers?.name ?? ''} ${entry.drivers?.cpf ?? ''} ${entry.description ?? ''} ${entry.notes ?? ''}`
              .toLowerCase()
              .includes(needle)
          );

    if (driverFilter) return bySearch(entries);

    if (conferenceWeekdayUi === null) {
      return bySearch(entries).filter((entry) =>
        matchesInstallmentSettlementFilter(entry, selectedCycleStart, installmentFilter)
      );
    }

    return bySearch(entries)
      .filter((entry) => matchesConferenceDate(entry, selectedCycleStart, discountRules))
      .filter((entry) => matchesInstallmentSettlementFilter(entry, selectedCycleStart, installmentFilter));
  }, [entries, search, selectedCycleStart, discountRules, conferenceWeekdayUi, installmentFilter, driverFilter]);

  const stats = useMemo(() => {
    let cycleDiscounts = 0;
    let cycleDailies = 0;
    let pendingApproval = 0;
    let openInCycle = 0;

    for (const entry of entries) {
      if (entry.status === 'pending_approval') pendingApproval++;
    }

    if (conferenceWeekdayUi === null) {
      return { cycleDiscounts: 0, cycleDailies: 0, pendingApproval, openInCycle: 0 };
    }

    for (const entry of entries) {
      if (!matchesConferenceDate(entry, selectedCycleStart, discountRules)) continue;
      if (!isPayableFinancialEntryStatus(entry.status)) continue;
      const onRef = installmentsOnReferenceDate(entry, selectedCycleStart);
      if (onRef.some((i) => isOpenInstallmentStatus(i.status))) openInCycle++;
      for (const inst of onRef) {
        if (!isOpenInstallmentStatus(inst.status)) continue;
        if (entry.type === 'daily') cycleDailies += Number(inst.amount);
        else cycleDiscounts += Number(inst.amount);
      }
    }

    return { cycleDiscounts, cycleDailies, pendingApproval, openInCycle };
  }, [entries, selectedCycleStart, discountRules, conferenceWeekdayUi]);

  const defaultInstallmentFilter: InstallmentSettlementFilter =
    conferenceWeekdayUi !== null ? 'pending' : 'all';

  const hasActiveFilters = (needle: string) =>
    Boolean(needle.trim()) ||
    typeFilter !== 'all' ||
    statusFilter !== 'all' ||
    Boolean(leaderFilter) ||
    Boolean(pharmacyFilter) ||
    Boolean(driverFilter) ||
    installmentFilter !== defaultInstallmentFilter;

  return {
    discountRules,
    setDiscountRules,
    selectedCycleStart,
    setSelectedCycleStart,
    entryTypesCtx,
    leadersList,
    pharmaciesList,
    occurrenceDrivers,
    occurrenceDriversLoading,
    entries,
    coverageMaps,
    conferenceWeekdayUi,
    finalFiltered,
    stats,
    isLoading,
    refetch,
    isFetching,
    defaultInstallmentFilter,
    hasActiveFilters,
  };
}
