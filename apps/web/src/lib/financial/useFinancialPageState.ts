import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { InstallmentSettlementFilter } from '@/lib/financial/types';

export function useFinancialPageState() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [leaderFilter, setLeaderFilter] = useState('');
  const [pharmacyFilter, setPharmacyFilter] = useState('');
  const [driverFilter, setDriverFilter] = useState('');
  const [installmentFilter, setInstallmentFilter] = useState<InstallmentSettlementFilter>('pending');
  const [showNew, setShowNew] = useState(false);
  const [showOccurrence, setShowOccurrence] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<import('@/lib/financial/types').ApiEntry | null>(null);

  const advanceApprovalMode = useMemo(() => {
    const fromTask = (searchParams.get('fromTask') || '').trim();
    const driverId = (searchParams.get('driver_id') || '').trim();
    const type = (searchParams.get('type') || '').trim();
    const decision = (searchParams.get('decision') || '').trim();
    const approvedAt = (searchParams.get('approved_at') || '').trim();
    const enabled = Boolean(fromTask && driverId && type === 'advance' && decision === 'approved');
    const startDate = (approvedAt ? new Date(approvedAt) : new Date()).toISOString().slice(0, 10);
    return { enabled, taskId: fromTask, driverId, startDate };
  }, [searchParams]);

  useEffect(() => {
    if (advanceApprovalMode.enabled) setShowNew(true);
  }, [advanceApprovalMode.enabled]);

  const urlDriverId = (searchParams.get('driver_id') || '').trim();
  const urlLeaderId = (searchParams.get('leader_id') || '').trim();
  const urlEntryId = (searchParams.get('entry_id') || '').trim();

  useEffect(() => {
    if (!urlDriverId) return;
    setDriverFilter(urlDriverId);
    setStatusFilter('all');
    setTypeFilter('all');
    setInstallmentFilter('all');
  }, [urlDriverId]);

  useEffect(() => {
    if (!urlEntryId) return;
    setSelectedId(urlEntryId);
  }, [urlEntryId]);

  useEffect(() => {
    if (!urlLeaderId) return;
    setLeaderFilter(urlLeaderId);
  }, [urlLeaderId]);

  const clearUrlDriver = () => {
    if (urlDriverId) router.replace('/financial');
  };

  return {
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    typeFilter,
    setTypeFilter,
    leaderFilter,
    setLeaderFilter,
    pharmacyFilter,
    setPharmacyFilter,
    driverFilter,
    setDriverFilter,
    installmentFilter,
    setInstallmentFilter,
    showNew,
    setShowNew,
    showOccurrence,
    setShowOccurrence,
    showImport,
    setShowImport,
    showRules,
    setShowRules,
    selectedId,
    setSelectedId,
    selectedEntry,
    setSelectedEntry,
    advanceApprovalMode,
    urlDriverId,
    clearUrlDriver,
    router,
  };
}
