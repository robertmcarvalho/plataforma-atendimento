import { useCallback } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import type { ApiEntry } from '@/lib/financial/types';
import type { DiscountRule } from '@/lib/financialCycle';

type MutationsInput = {
  qc: QueryClient;
  entries: ApiEntry[];
  setDiscountRules: (rules: Record<string, DiscountRule>) => void;
  setSelectedId: (id: string | null) => void;
  setSelectedEntry: (entry: ApiEntry | null) => void;
};

export function useFinancialMutations({
  qc,
  entries,
  setDiscountRules,
  setSelectedId,
  setSelectedEntry,
}: MutationsInput) {
  const saveDiscountRules = useCallback(
    async (rules: Record<string, DiscountRule>) => {
      try {
        await api.put('/api/financial/discount-rules', { rules });
        setDiscountRules(rules);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem('financial-discount-rules', JSON.stringify(rules));
        }
        void qc.invalidateQueries({ queryKey: ['financial-discount-rules'] });
      } catch (e: unknown) {
        window.alert(
          apiErrorMessage(e, 'Não foi possível salvar as regras no servidor. Verifique permissões (admin/financeiro).'),
        );
      }
    },
    [qc, setDiscountRules]
  );

  const openLinkedEntry = useCallback(
    async (entryId: string | null | undefined) => {
      if (!entryId) return;
      await qc.prefetchQuery({
        queryKey: ['financial-entry-detail', entryId],
        queryFn: () => api.get(`/api/financial/entries/${entryId}`).then((r) => r.data as ApiEntry),
      });
      let linked = entries.find((e) => e.id === entryId) ?? null;
      if (!linked) {
        try {
          linked = await api.get(`/api/financial/entries/${entryId}`).then((r) => r.data as ApiEntry);
        } catch {
          linked = null;
        }
      }
      setSelectedId(entryId);
      setSelectedEntry(linked);
    },
    [entries, qc, setSelectedEntry, setSelectedId]
  );

  return { saveDiscountRules, openLinkedEntry };
}
