'use client';

import { BillingOffboardingConferenceView } from '@/components/billing/BillingOffboardingConferenceView';

type Props = {
  previewId: string;
};

export function BillingOffboardingPreviewPanel({ previewId }: Props) {
  return <BillingOffboardingConferenceView previewId={previewId} />;
}
