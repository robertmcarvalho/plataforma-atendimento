'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Edição local de catálogos comerciais — evita PUT a cada tecla. */
export function useCatalogDraft<T extends { id: string }>(
  serverItems: T[],
  save: (items: T[]) => Promise<unknown>,
  options?: { validate?: (items: T[]) => T[] | null }
) {
  const [draft, setDraft] = useState<T[]>(serverItems);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (!dirtyRef.current) setDraft(serverItems);
  }, [serverItems]);

  const persist = useCallback(
    async (next: T[]) => {
      const validated = options?.validate ? options.validate(next) : next;
      if (validated === null) return;
      setSaving(true);
      try {
        await save(validated);
        setDraft(validated);
        setDirty(false);
        setMsg(null);
      } catch (e) {
        setMsg(e instanceof Error ? e.message : 'Falha ao salvar');
      } finally {
        setSaving(false);
      }
    },
    [options, save]
  );

  const patchLocal = useCallback((id: string, patch: Partial<T>) => {
    setDraft((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
    setDirty(true);
  }, []);

  const flush = useCallback(() => {
    if (!dirtyRef.current) return;
    void persist(draft);
  }, [draft, persist]);

  const replaceLocal = useCallback((next: T[]) => {
    setDraft(next);
    setDirty(true);
  }, []);

  const saveNow = useCallback(
    (next?: T[]) => {
      void persist(next ?? draft);
    },
    [draft, persist]
  );

  return {
    draft,
    dirty,
    msg,
    saving,
    patchLocal,
    replaceLocal,
    flush,
    saveNow,
    setMsg,
  };
}
