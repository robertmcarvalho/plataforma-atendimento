'use client';

import { Suspense, use } from 'react';
import { BillingAcertoGroupDetailPanel } from '@/components/billing/BillingAcertoGroupDetailPanel';

function AcertoDetailInner({ cycleId, pharmacyId }: { cycleId: string; pharmacyId: string }) {
  return <BillingAcertoGroupDetailPanel cycleId={cycleId} pharmacyId={pharmacyId} />;
}

export default function BillingAcertoGroupPage({
  params,
}: {
  params: Promise<{ cycleId: string; pharmacyId: string }>;
}) {
  const { cycleId, pharmacyId } = use(params);
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Carregando acerto…</div>}>
      <AcertoDetailInner cycleId={cycleId} pharmacyId={pharmacyId} />
    </Suspense>
  );
}
