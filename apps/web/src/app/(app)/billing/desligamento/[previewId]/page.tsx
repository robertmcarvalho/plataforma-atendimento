'use client';

import { Suspense, use } from 'react';
import { BillingOffboardingPreviewPanel } from '@/components/billing/BillingOffboardingPreviewPanel';

function OffboardingDetailInner({ previewId }: { previewId: string }) {
  return <BillingOffboardingPreviewPanel previewId={previewId} />;
}

export default function BillingOffboardingPreviewPage({
  params,
}: {
  params: Promise<{ previewId: string }>;
}) {
  const { previewId } = use(params);
  return (
    <Suspense fallback={<div className="text-sm text-muted-foreground">Carregando prévia…</div>}>
      <OffboardingDetailInner previewId={previewId} />
    </Suspense>
  );
}
