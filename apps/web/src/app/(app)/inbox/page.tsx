'use client';

import { InboxPageContent } from '@/components/inbox/InboxPageContent';
import { useInboxPageController } from '@/lib/inbox/useInboxPageController';

export default function InboxPage() {
  const controller = useInboxPageController();
  return <InboxPageContent {...controller} />;
}
