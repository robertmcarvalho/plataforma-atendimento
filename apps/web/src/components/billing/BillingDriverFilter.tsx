'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';
import { BillingField } from '@/components/billing/BillingPrimitives';
import api from '@/lib/api';
import { cleanBillingLabel } from '@/lib/billing/billingDisplay';
import { isDriverLinkedToPharmacy, type DriverPharmacyLinkLike } from '@/lib/billing/isDriverLinkedToPharmacy';
import { cadastroPageApi } from '@/lib/cadastro/cadastroPageApi';

type DriverRow = DriverPharmacyLinkLike & { id: string; name: string };

export function BillingDriverFilter({
  value,
  onChange,
  pharmacyId,
  label = 'Entregador',
  className,
  /** When true, driver search requires pharmacy and only shows linked drivers. */
  requirePharmacy = false,
  disabled,
}: {
  value: string;
  onChange: (driverId: string) => void;
  pharmacyId?: string;
  label?: string;
  className?: string;
  requirePharmacy?: boolean;
  disabled?: boolean;
}) {
  const [remoteCache, setRemoteCache] = useState<DriverRow[]>([]);
  const remoteCacheRef = useRef<DriverRow[]>([]);

  const driversQuery = useQuery({
    queryKey: ['drivers', 'active', 'billing-filter'],
    queryFn: () => api.get('/api/drivers', { params: { status: 'active' } }).then((r) => r.data as DriverRow[]),
  });

  const drivers = useMemo(() => driversQuery.data || [], [driversQuery.data]);
  const pharmacy = pharmacyId || '';

  const linkedDrivers = useMemo(() => {
    if (!pharmacy) return [];
    return drivers.filter((d) => isDriverLinkedToPharmacy(d, pharmacy));
  }, [drivers, pharmacy]);

  // Cascade: clearing pharmacy clears driver; switching pharmacy clears if not linked.
  const prevPharmacyRef = useRef(pharmacy);
  useEffect(() => {
    const prev = prevPharmacyRef.current;
    prevPharmacyRef.current = pharmacy;
    if (!value) return;
    if (!pharmacy) {
      if (prev || requirePharmacy) onChange('');
      return;
    }
    if (prev === pharmacy) return;
    const fromList = drivers.find((d) => d.id === value);
    const fromRemote = remoteCacheRef.current.find((d) => d.id === value);
    const driver = fromList || fromRemote;
    if (!driver || !isDriverLinkedToPharmacy(driver, pharmacy)) {
      onChange('');
    }
  }, [pharmacy, value, drivers, onChange, requirePharmacy]);

  const linkedOptions = useMemo(
    () => linkedDrivers.map((d) => ({ value: d.id, label: cleanBillingLabel(d.name) })),
    [linkedDrivers]
  );

  const mergeRemote = useCallback((rows: DriverRow[]) => {
    const byId = new Map(remoteCacheRef.current.map((d) => [d.id, d]));
    for (const row of rows) byId.set(row.id, row);
    const next = [...byId.values()];
    remoteCacheRef.current = next;
    setRemoteCache(next);
  }, []);

  const resolveGlobal = useCallback(
    async (query: string) => {
      const rows = (await cadastroPageApi.fetchDrivers({
        search: query,
        status: 'active',
      })) as DriverRow[];
      mergeRemote(rows);
      return rows.map((d) => ({ value: d.id, label: cleanBillingLabel(d.name) }));
    },
    [mergeRemote]
  );

  const pharmacyLocked = requirePharmacy && !pharmacy;
  const useLinkedList = Boolean(pharmacy);

  const placeholder = pharmacyLocked
    ? 'Selecione a farmácia primeiro'
    : pharmacy
      ? 'Buscar entregador vinculado…'
      : 'Buscar entregador…';

  const emptyLabel =
    pharmacy && !driversQuery.isLoading && linkedDrivers.length === 0
      ? 'Nenhum entregador vinculado a esta farmácia'
      : 'Nenhum entregador encontrado';

  const globalOptions = useMemo(
    () => [
      ...drivers.map((d) => ({ value: d.id, label: cleanBillingLabel(d.name) })),
      ...remoteCache.map((d) => ({ value: d.id, label: cleanBillingLabel(d.name) })),
    ],
    [drivers, remoteCache]
  );

  return (
    <BillingField label={label} className={className}>
      <FormSearchCombobox
        className="mt-1 w-full min-w-[200px]"
        inputSize="sm"
        value={value}
        onChange={onChange}
        disabled={disabled || pharmacyLocked || (useLinkedList && driversQuery.isLoading)}
        placeholder={placeholder}
        emptyLabel={emptyLabel}
        minChars={useLinkedList ? 0 : 2}
        options={useLinkedList ? linkedOptions : globalOptions}
        resolveOptions={useLinkedList ? undefined : resolveGlobal}
      />
    </BillingField>
  );
}
