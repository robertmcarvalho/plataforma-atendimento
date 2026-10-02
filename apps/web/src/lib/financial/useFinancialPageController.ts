import { FinancialEntryStatus } from '@plataforma/operational-notes';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/store/auth';
import { useFinancialMutations } from '@/lib/financial/useFinancialMutations';
import { useFinancialPageState } from '@/lib/financial/useFinancialPageState';
import { useFinancialSummary } from '@/lib/financial/useFinancialSummary';
import { hasResourcePermission } from '@/lib/permissions';

export function useFinancialPageController() {
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const state = useFinancialPageState();

  const role = user?.role || '';
  const permissions = user?.permissions;
  const canRegisterOccurrence =
    ['admin', 'financial', 'supervisor'].includes(role) ||
    hasResourcePermission(permissions, 'financial', 'manage');
  const canApprove =
    ['admin', 'supervisor'].includes(role) ||
    hasResourcePermission(permissions, 'financial', 'approve');

  const summary = useFinancialSummary({
    statusFilter: state.statusFilter,
    typeFilter: state.typeFilter,
    leaderFilter: state.leaderFilter,
    pharmacyFilter: state.pharmacyFilter,
    driverFilter: state.driverFilter,
    installmentFilter: state.installmentFilter,
    search: state.search,
    showOccurrence: state.showOccurrence,
    canRegisterOccurrence,
  });

  const mutations = useFinancialMutations({
    qc,
    entries: summary.entries,
    setDiscountRules: summary.setDiscountRules,
    setSelectedId: state.setSelectedId,
    setSelectedEntry: state.setSelectedEntry,
  });

  const clearFilters = () => {
    state.setSearch('');
    state.setTypeFilter('all');
    state.setStatusFilter('all');
    state.setLeaderFilter('');
    state.setPharmacyFilter('');
    state.setDriverFilter('');
    state.setInstallmentFilter(summary.defaultInstallmentFilter);
    state.clearUrlDriver();
  };

  const togglePendingApprovalFilter = () => {
    state.setStatusFilter((s) =>
      s === FinancialEntryStatus.PENDING_APPROVAL ? 'all' : FinancialEntryStatus.PENDING_APPROVAL
    );
  };

  const selectEntry = (entry: import('@/lib/financial/types').ApiEntry) => {
    state.setSelectedId(entry.id);
    state.setSelectedEntry(entry);
  };

  return {
    user,
    state,
    summary,
    mutations,
    canRegisterOccurrence,
    canApprove,
    clearFilters,
    togglePendingApprovalFilter,
    selectEntry,
  };
}

export type FinancialPageController = ReturnType<typeof useFinancialPageController>;
