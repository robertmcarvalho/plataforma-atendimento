'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FormControl } from '@/components/form/FormControl';
import { SearchComboboxDropdown } from '@/components/form/SearchComboboxDropdown';
import type { SelectOption } from '@/components/form/ToolbarSelect';
import {
  effectiveSearchMinChars,
  filterSelectOptions,
  shouldRequireSearchQuery,
} from '@/lib/form/searchComboboxUtils';
import { cn } from '@/lib/utils';

export function FormSearchCombobox({
  value,
  onChange,
  options,
  placeholder = 'Buscar…',
  emptyLabel = 'Nenhum resultado encontrado',
  disabled,
  className,
  inputSize = 'md',
  minChars = 0,
  resolveOptions,
  portal = true,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  className?: string;
  inputSize?: 'sm' | 'md' | 'lg';
  minChars?: number;
  /** Busca remota (ex.: entregadores fora da lista pré-carregada). */
  resolveOptions?: (query: string) => Promise<SelectOption[]>;
  /** Renderiza o menu em portal (evita corte por overflow-hidden). */
  portal?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [selectedLabel, setSelectedLabel] = useState('');
  const [remoteOptions, setRemoteOptions] = useState<SelectOption[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);

  const displayValue = open ? query : selectedLabel || query;
  const asyncMode = Boolean(resolveOptions);

  useEffect(() => {
    if (!value) {
      setSelectedLabel('');
      if (!open) setQuery('');
      return;
    }
    const match =
      options.find((o) => o.value === value) || remoteOptions.find((o) => o.value === value);
    if (match) setSelectedLabel(match.label);
  }, [value, options, remoteOptions, open]);

  useEffect(() => {
    if (!resolveOptions || !open) return;
    const trimmed = query.trim();
    const minLen = effectiveSearchMinChars(minChars);
    if (trimmed.length < minLen) {
      setRemoteOptions([]);
      setRemoteLoading(false);
      return;
    }

    let cancelled = false;
    setRemoteLoading(true);
    const timer = window.setTimeout(() => {
      void resolveOptions(trimmed)
        .then((next) => {
          if (!cancelled) setRemoteOptions(next);
        })
        .finally(() => {
          if (!cancelled) setRemoteLoading(false);
        });
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [resolveOptions, query, open, minChars]);

  const filtered = useMemo(() => {
    if (asyncMode) return remoteOptions;
    return filterSelectOptions(options, query, minChars);
  }, [asyncMode, remoteOptions, options, query, minChars]);

  const dropdownItems = useMemo(
    () => filtered.map((o) => ({ id: o.value, label: o.label })),
    [filtered]
  );

  const pick = useCallback(
    (id: string, label: string) => {
      setSelectedLabel(label);
      setQuery('');
      onChange(id);
      setOpen(false);
    },
    [onChange]
  );

  useEffect(() => {
    if (!open) setHighlightIndex(-1);
  }, [open, dropdownItems]);

  useEffect(() => {
    const onDocClick = (ev: MouseEvent) => {
      const target = ev.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[role="listbox"]')) return;
      setOpen(false);
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

  const trimmed = query.trim();
  const usableCount = useMemo(() => options.filter((o) => !o.disabled).length, [options]);
  const requireQuery = asyncMode || shouldRequireSearchQuery(usableCount);
  const minQueryLen = effectiveSearchMinChars(minChars);
  const showDropdown =
    open &&
    (requireQuery ? trimmed.length >= minQueryLen && (!asyncMode || !remoteLoading) : true);
  const showHint = open && requireQuery && trimmed.length > 0 && trimmed.length < minQueryLen;
  const showTypeToSearch = open && requireQuery && trimmed.length === 0;
  const showLoading = open && asyncMode && remoteLoading && trimmed.length >= minQueryLen;

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
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!open) setOpen(true);
            e.preventDefault();
            if (!showDropdown && e.key === 'ArrowDown' && dropdownItems.length > 0) {
              setHighlightIndex(0);
            }
            return;
          }
          if (!showDropdown || dropdownItems.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightIndex((i) => Math.min(i + 1, dropdownItems.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && highlightIndex >= 0) {
            e.preventDefault();
            const item = dropdownItems[highlightIndex];
            if (item) pick(item.id, item.label);
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
      />

      {showDropdown ? (
        <SearchComboboxDropdown
          items={dropdownItems}
          value={value}
          onPick={pick}
          emptyLabel={emptyLabel}
          anchorRef={rootRef}
          portal={portal}
          highlightIndex={highlightIndex}
        />
      ) : null}

      {showTypeToSearch ? (
        <p className="mt-1 text-[11px] text-muted-foreground">Digite para buscar</p>
      ) : null}

      {showHint ? (
        <p className="mt-1 text-[11px] text-muted-foreground">Digite pelo menos {minQueryLen} caracteres</p>
      ) : null}

      {showLoading ? (
        <p className="mt-1 text-[11px] text-muted-foreground">Buscando…</p>
      ) : null}
    </div>
  );
}
