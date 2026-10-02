'use client';

import { Suspense, use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { fetchBillingSettlement } from '@/lib/billing/billingApi';

function SettlementLegacyRedirect({ id }: { id: string }) {
  const router = useRouter();

  const query = useQuery({
    queryKey: ['billing', 'settlement', id],
    queryFn: () => fetchBillingSettlement(id),
    enabled: !!id,
    retry: 1,
  });

  useEffect(() => {
    const settlement = query.data;
    if (settlement?.billing_cycle_id && settlement?.pharmacy_id) {
      const qs = typeof window !== 'undefined' ? window.location.search : '';
      router.replace(
        `/billing/acertos/ciclo/${settlement.billing_cycle_id}/farmacia/${settlement.pharmacy_id}${qs}`
      );
    }
  }, [query.data, router]);

  if (query.isError) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-destructive">Não foi possível abrir o acerto.</p>
        <p className="text-muted-foreground">
          {(query.error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
            'Verifique se a API local está rodando e tente novamente.'}
        </p>
      </div>
    );
  }

  return <div className="text-sm text-muted-foreground">Abrindo detalhe do acerto…</div>;
}

export default function BillingSettlementLegacyRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Carregando…</div>}>
      <SettlementLegacyRedirect id={id} />
    </Suspense>
  );
}
