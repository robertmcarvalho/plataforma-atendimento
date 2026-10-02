'use client';

import { useEffect, useState } from 'react';

/** Evita flash de conteúdo antes do rehydrate do Zustand persist. */
export function useCommercialHydrated() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return hydrated;
}
