'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LEADER_OCCURRENCES_PATH } from '@/lib/leaderPortal/leaderOccurrencesPath';

/** Redireciona rota legada /lider/faltas → /lider/ocorrencias (preserva query string). */
export default function LiderFaltasRedirectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const qs = searchParams.toString();
    router.replace(qs ? `${LEADER_OCCURRENCES_PATH}?${qs}` : LEADER_OCCURRENCES_PATH);
  }, [router, searchParams]);

  return null;
}
