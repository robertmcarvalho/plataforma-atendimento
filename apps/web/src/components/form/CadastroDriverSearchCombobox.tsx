'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';
import { cadastroPageApi } from '@/lib/cadastro/cadastroPageApi';
import type { OccurrenceDriverOption } from '@/lib/occurrenceForm';

type CadastroDriverRow = {
  id: string;
  name: string;
  primary_pharmacy_id?: string | null;
  driver_pharmacy_links?: Array<{
    is_active?: boolean;
    pharmacies?: { id: string } | null;
  }>;
};

function toOccurrenceDriver(row: CadastroDriverRow): OccurrenceDriverOption {
  const links = (row.driver_pharmacy_links || [])
    .filter((l) => l.is_active !== false && l.pharmacies?.id)
    .map((l) => String(l.pharmacies!.id));
  const primary = row.primary_pharmacy_id ? String(row.primary_pharmacy_id) : null;
  return {
    id: String(row.id),
    name: String(row.name || ''),
    primary_pharmacy_id: primary,
    leader_linked_pharmacy_ids: links.length > 0 ? links : primary ? [primary] : [],
  };
}

export function CadastroDriverSearchCombobox({
  value,
  onChange,
  onDriverSelect,
  disabled,
  placeholder = 'Buscar entregador…',
  emptyLabel = 'Nenhum entregador encontrado',
  className,
  inputSize = 'md',
}: {
  value: string;
  onChange: (id: string) => void;
  onDriverSelect?: (driver: OccurrenceDriverOption | null) => void;
  disabled?: boolean;
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
  inputSize?: 'sm' | 'md' | 'lg';
}) {
  const [cache, setCache] = useState<OccurrenceDriverOption[]>([]);
  const cacheRef = useRef<OccurrenceDriverOption[]>([]);

  const mergeCache = useCallback((rows: OccurrenceDriverOption[]) => {
    const byId = new Map(cacheRef.current.map((d) => [d.id, d]));
    for (const row of rows) byId.set(row.id, row);
    const next = [...byId.values()];
    cacheRef.current = next;
    setCache(next);
  }, []);

  const resolveOptions = useCallback(
    async (query: string) => {
      const rows = (await cadastroPageApi.fetchDrivers({
        search: query,
        status: 'active',
      })) as CadastroDriverRow[];
      const mapped = rows.map(toOccurrenceDriver);
      mergeCache(mapped);
      return mapped.map((d) => ({ value: d.id, label: d.name }));
    },
    [mergeCache]
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
      if (match) onDriverSelect?.(match);
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
