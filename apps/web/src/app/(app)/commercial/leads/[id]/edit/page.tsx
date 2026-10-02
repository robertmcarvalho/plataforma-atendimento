'use client';

import { use } from 'react';
import { CommercialLeadEditPage } from '@/components/commercial/CommercialLeadEditPage';

export default function CommercialLeadEditRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <CommercialLeadEditPage leadId={id} />;
}
