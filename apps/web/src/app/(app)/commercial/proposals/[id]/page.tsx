'use client';

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CommercialProposalPage } from '@/components/commercial/CommercialProposalPage';
import { CommercialListSkeleton } from '@/components/commercial/CommercialSkeleton';
import { useCommercialProposalsEnabled } from '@/lib/commercial/useCommercialQueries';

export default function CommercialProposalRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: proposalsEnabled, isLoading } = useCommercialProposalsEnabled();

  useEffect(() => {
    if (!isLoading && proposalsEnabled === false) {
      router.replace('/commercial/pipeline');
    }
  }, [isLoading, proposalsEnabled, router]);

  if (isLoading) return <CommercialListSkeleton rows={4} />;
  if (!proposalsEnabled) return null;

  return <CommercialProposalPage proposalId={id} />;
}
