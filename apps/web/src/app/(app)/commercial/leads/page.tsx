import { Suspense } from 'react';
import { CommercialLeadsPage } from '@/components/commercial/CommercialLeadsPage';

export default function CommercialLeadsRoute() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Carregando leads...</div>}>
      <CommercialLeadsPage />
    </Suspense>
  );
}
