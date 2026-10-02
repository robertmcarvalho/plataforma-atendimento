'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'ops-hub-filters-v1';

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

type StoredFilters = {
  period: number;
  referenceDate: string;
  pharmacyId: string;
};

function loadStored(defaultPeriod: number): StoredFilters {
  if (typeof window === 'undefined') {
    return { period: defaultPeriod, referenceDate: todayIsoDate(), pharmacyId: '' };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { period: defaultPeriod, referenceDate: todayIsoDate(), pharmacyId: '' };
    const parsed = JSON.parse(raw) as Partial<StoredFilters>;
    return {
      period: typeof parsed.period === 'number' ? parsed.period : defaultPeriod,
      referenceDate: typeof parsed.referenceDate === 'string' ? parsed.referenceDate : todayIsoDate(),
      pharmacyId: typeof parsed.pharmacyId === 'string' ? parsed.pharmacyId : '',
    };
  } catch {
    return { period: defaultPeriod, referenceDate: todayIsoDate(), pharmacyId: '' };
  }
}

/** Período, data de referência e farmácia compartilhados nos hubs de operação. */
export function useOpsHubFilters(defaultPeriod = 7) {
  const [period, setPeriod] = useState(defaultPeriod);
  const [referenceDate, setReferenceDate] = useState(todayIsoDate);
  const [pharmacyId, setPharmacyId] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = loadStored(defaultPeriod);
    setPeriod(stored.period);
    setReferenceDate(stored.referenceDate);
    setPharmacyId(stored.pharmacyId);
    setHydrated(true);
  }, [defaultPeriod]);

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ period, referenceDate, pharmacyId }));
  }, [period, referenceDate, pharmacyId, hydrated]);

  return {
    period,
    setPeriod,
    referenceDate,
    setReferenceDate,
    pharmacyId,
    setPharmacyId,
    hydrated,
  } as const;
}
