'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/lib/api';
import { FormControl } from '@/components/form/FormControl';
import { SearchComboboxDropdown } from '@/components/form/SearchComboboxDropdown';
import { cn } from '@/lib/utils';
import { formatBrazilPhone } from '@/lib/brFormat';

type Entity = 'driver' | 'pharmacy' | 'leader';

type Hit = {
  id: string;
  name?: string;
  trade_name?: string;
  phone?: string | null;
};

const ENTITY_CONFIG: Record<
  Entity,
  {
    endpoint: string;
    placeholder: string;
    emptyLabel: string;
    label: (hit: Hit) => string;
  }
> = {
  driver: {
    endpoint: '/api/drivers',
    placeholder: 'Buscar por nome, CPF ou telefone...',
    emptyLabel: 'Nenhum entregador encontrado',
    label: (h) => {
      const phone = h.phone ? formatBrazilPhone(h.phone) || h.phone : '';
      return phone ? `${h.name || ''} · ${phone}` : String(h.name || '');
    },
  },
  pharmacy: {
    endpoint: '/api/pharmacies',
    placeholder: 'Buscar farmácia...',
    emptyLabel: 'Nenhuma farmácia encontrada',
    label: (h) => {
      const phone = h.phone ? formatBrazilPhone(h.phone) || h.phone : '';
      const name = h.trade_name || h.name || '';
      return phone ? `${name} · ${phone}` : name;
    },
  },
  leader: {
    endpoint: '/api/leaders',
    placeholder: 'Buscar líder...',
    emptyLabel: 'Nenhum líder encontrado',
    label: (h) => {
      const phone = h.phone ? formatBrazilPhone(h.phone) || h.phone : '';
      return phone ? `${h.name || ''} · ${phone}` : String(h.name || '');
    },
  },
};

export function CadastroSearchCombobox({
  entity,
  value,
  onChange,
  status = 'active',
  minChars = 2,
  debounceMs = 320,
  className,
  disabled,
  extraParams,
  onSelect,
  inputSize = 'lg',
}: {
  entity: Entity;
  value: string;
  onChange: (id: string) => void;
  status?: 'active' | 'inactive' | string;
  minChars?: number;
  debounceMs?: number;
  className?: string;
  disabled?: boolean;
  extraParams?: Record<string, string | undefined>;
  onSelect?: (payload: { id: string; label: string }) => void;
  inputSize?: 'sm' | 'md' | 'lg';
}) {
  const config = ENTITY_CONFIG[entity];
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState('');

  const displayValue = open ? query : selectedLabel || query;

  useEffect(() => {
    if (!value) {
      setSelectedLabel('');
      if (!open) setQuery('');
    }
  }, [value, open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < minChars) {
      setHits([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const params: Record<string, string> = { status, search: q };
          for (const [k, v] of Object.entries(extraParams || {})) {
            if (v) params[k] = v;
          }
          const { data } = await api.get<Hit[]>(config.endpoint, { params });
          const rows = Array.isArray(data) ? data.slice(0, 20) : [];
          setHits(rows);
        } catch (e: unknown) {
          const ax = e as { response?: { data?: { error?: string } }; message?: string };
          setError(ax.response?.data?.error || ax.message || 'Falha na busca');
          setHits([]);
        } finally {
          setLoading(false);
        }
      })();
    }, debounceMs);

    return () => window.clearTimeout(timer);
  }, [query, open, minChars, debounceMs, status, config, onChange, extraParams]);

  useEffect(() => {
    const onDocClick = (ev: MouseEvent) => {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const pick = useCallback(
    (hit: Hit) => {
      const label = config.label(hit);
      setSelectedLabel(label);
      setQuery('');
      onChange(hit.id);
      onSelect?.({ id: hit.id, label });
      setOpen(false);
      setHits([]);
    },
    [config, onChange, onSelect]
  );

  const trimmed = query.trim();
  const showDropdown = open && trimmed.length >= minChars;
  const showHint = open && trimmed.length > 0 && trimmed.length < minChars;
  const showTypeToSearch = open && trimmed.length === 0;

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <FormControl
        inputSize={inputSize}
        value={displayValue}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          setSelectedLabel('');
          onChange('');
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={config.placeholder}
        autoComplete="off"
      />

      {showDropdown ? (
        <SearchComboboxDropdown
          items={hits.map((hit) => ({ id: hit.id, label: config.label(hit) }))}
          value={value}
          onPick={(id) => {
            const hit = hits.find((h) => h.id === id);
            if (hit) pick(hit);
          }}
          loading={loading}
          error={error}
          emptyLabel={config.emptyLabel}
        />
      ) : null}

      {showTypeToSearch ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Digite pelo menos {minChars} caracteres para buscar
        </p>
      ) : null}

      {showHint ? (
        <p className="mt-1 text-[11px] text-muted-foreground">Digite pelo menos {minChars} caracteres</p>
      ) : null}
    </div>
  );
}
