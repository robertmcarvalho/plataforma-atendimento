'use client';

import { createContext, useContext } from 'react';
import { DEFAULT_TYPE_LABELS, buildTypeLabels } from '@/lib/financial/financialLabels';
import type { EntryTypesCtx } from '@/lib/financial/types';

export { buildTypeLabels };
export type { EntryTypesCtx };

const EntryTypesContext = createContext<EntryTypesCtx>({ types: [], labels: DEFAULT_TYPE_LABELS });

export function EntryTypesProvider({
  value,
  children,
}: {
  value: EntryTypesCtx;
  children: React.ReactNode;
}) {
  return <EntryTypesContext.Provider value={value}>{children}</EntryTypesContext.Provider>;
}

export function useEntryTypes(): EntryTypesCtx {
  return useContext(EntryTypesContext);
}

export function useTypeLabels(): Record<string, string> {
  return useContext(EntryTypesContext).labels;
}
