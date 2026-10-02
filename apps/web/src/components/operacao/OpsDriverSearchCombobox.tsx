'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';
import { fetchOpsDriverSearch, type OpsDriverSearchResult } from '@/lib/ops/opsAnalyticsApi';
import type { OccurrenceDriverOption } from '@/lib/occurrenceForm';

function toOccurrenceDriver(row: OpsDriverSearchResult): OccurrenceDriverOption {
  return {
    id: row.id,
    name: row.name,
    primary_pharmacy_id: row.primary_pharmacy_id ?? null,
    leader_linked_pharmacy_ids: row.leader_linked_pharmacy_ids ?? [],
  };
}

export function OpsDriverSearchCombobox({
  scope,
  leaderId,
  value,
  onChange,
  onDriverSelect,
  disabled,
  placeholder = 'Buscar entregador…',
  emptyLabel = 'Nenhum entregador encontrado',
  className,
  inputSize = 'lg',
}: {
  scope: 'ag' | 'portfolio';
  leaderId?: string;
  value: string;
  onChange: (id: string) => void;
  onDriverSelect?: (driver: OccurrenceDriverOption | null) => void;
  disabled?: boolean;
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
  inputSize?: 'sm' | 'md' | 'lg';
}) {
  const [cache, setCache] = useState<OpsDriverSearchResult[]>([]);
  const cacheRef = useRef<OpsDriverSearchResult[]>([]);

  const mergeCache = useCallback((rows: OpsDriverSearchResult[]) => {
    const byId = new Map(cacheRef.current.map((d) => [d.id, d]));
    for (const row of rows) byId.set(row.id, row);
    const next = [...byId.values()];
    cacheRef.current = next;
    setCache(next);
  }, []);

  const resolveOptions = useCallback(
    async (query: string) => {
      const rows = await fetchOpsDriverSearch({
        q: query,
        scope,
        leader_id: leaderId,
      });
      mergeCache(rows);
      return rows.map((d) => ({ value: d.id, label: d.name }));
    },
    [scope, leaderId, mergeCache]
  );

  const options = useMemo(
    () => cache.map((d) => ({ value: d.id, label: d.name })),
    [cache]
  );

  const handleChange = useCallback(
    (id: string) => {
      onChange(id);
      if (!id) {
        onDriverSelect?.(null);
        return;
      }
      const match = cacheRef.current.find((d) => d.id === id);
      if (match) onDriverSelect?.(toOccurrenceDriver(match));
    },
    [onChange, onDriverSelect]
  );

  return (
    <FormSearchCombobox
      value={value}
      onChange={handleChange}
      options={options}
      resolveOptions={resolveOptions}
      minChars={2}
      disabled={disabled}
      placeholder={placeholder}
      emptyLabel={emptyLabel}
      className={className}
      inputSize={inputSize}
    />
  );
}
