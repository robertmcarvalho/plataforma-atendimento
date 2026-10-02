// WIP � feature paused. Flag: ticketingPanel in lib/features.ts
// Do not delete. Context: codebase audit Phase A (ticketing panel soft-pause)

'use client';

import { useMemo } from 'react';
import { deriveEntityIdsFromDetail } from '@/lib/ticketing/deriveEntityIds';
import { useActiveTicket } from '@/lib/ticketing/useActiveTicket';
import { PharmacyContextCard } from './PharmacyContextCard';
import { LeaderContextCard } from './LeaderContextCard';
import { DriverFinancialReviewPanel } from './DriverFinancialReviewPanel';
import { TicketHistoryCard } from './TicketHistoryCard';

export function InboxTicketingSidecar({
  conversationId,
  detail,
}: {
  conversationId: string | null;
  detail: unknown;
}) {
  const entityIds = useMemo(() => deriveEntityIdsFromDetail(detail), [detail]);
  const ticketQuery = useActiveTicket(conversationId);

  const contactId = useMemo(() => {
    if (!detail || typeof detail !== 'object') return null;
    const d = detail as Record<string, unknown>;
    const c = d.contacts as Record<string, unknown> | undefined;
    const id = c?.id;
    return typeof id === 'string' ? id : null;
  }, [detail]);

  return (
    <div className="border-b border-border px-4 py-4">
      <div className="inbox-context-body space-y-3">
        <PharmacyContextCard pharmacyId={entityIds.pharmacy_id} driverId={entityIds.driver_id} />
        <LeaderContextCard pharmacyId={entityIds.pharmacy_id} leaderEntityId={entityIds.leader_id} driverId={entityIds.driver_id} />
        <DriverFinancialReviewPanel driverId={entityIds.driver_id} />
        <TicketHistoryCard
          entityIds={entityIds}
          contactId={contactId}
          excludeTicketId={ticketQuery.data?.id ?? null}
        />
      </div>
    </div>
  );
}
