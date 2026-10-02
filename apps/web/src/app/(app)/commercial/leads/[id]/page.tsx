'use client';

import { Suspense, use } from 'react';
import { useSearchParams } from 'next/navigation';
import { CommercialLeadFichaPage } from '@/components/commercial/CommercialLeadFichaPage';

const TABS = ['Resumo', 'Conversa', 'Atividades', 'Proposta', 'Viabilidade'] as const;

function LeadDetailInner({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const initialTab = TABS.includes(tabParam as (typeof TABS)[number])
    ? (tabParam as (typeof TABS)[number])
    : undefined;

  return <CommercialLeadFichaPage leadId={id} initialTab={initialTab} />;
}

export default function CommercialLeadDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Carregando ficha...</div>}>
      <LeadDetailInner id={id} />
    </Suspense>
  );
}
