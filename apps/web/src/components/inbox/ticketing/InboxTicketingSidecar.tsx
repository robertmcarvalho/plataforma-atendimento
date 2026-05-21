'use client';

import { useMemo } from 'react';
import type { AiFeaturesState } from '@/lib/ai/defaults';
import { AiAnalysisAccordion } from '@/components/inbox/ai/AiAnalysisAccordion';
import { deriveEntityIdsFromDetail } from '@/lib/ticketing/deriveEntityIds';
import { useActiveTicket } from '@/lib/ticketing/useActiveTicket';
import { useTicketTimeline } from '@/lib/ticketing/useTicketTimeline';
import { PharmacyContextCard } from './PharmacyContextCard';
import { LeaderContextCard } from './LeaderContextCard';
import { FinancialMonthCard } from './FinancialMonthCard';
import { TicketHistoryCard } from './TicketHistoryCard';
import { TicketSummaryAccordion } from './TicketSummaryAccordion';
import { OperationalContextAccordion } from './OperationalContextAccordion';
import { RoutingExplainAccordion } from './RoutingExplainAccordion';
import { FinancialSnapshotAccordion } from './FinancialSnapshotAccordion';
import { TimelineAccordion } from './TimelineAccordion';

export function InboxTicketingSidecar({
  conversationId,
  detail,
  aiAccordionFlags,
}: {
  conversationId: string | null;
  detail: unknown;
  /** Quando definido, mostra acordeão "Insights de IA" respeitando cada flag de capacidade. */
  aiAccordionFlags?: AiFeaturesState;
}) {
  const entityIds = useMemo(() => deriveEntityIdsFromDetail(detail), [detail]);
  const ticketQuery = useActiveTicket(conversationId);
  const ticket = ticketQuery.data ?? null;
  const timelineQuery = useTicketTimeline(ticket?.id);

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
        <TicketSummaryAccordion
          ticket={ticket}
          conversationId={conversationId}
          loading={ticketQuery.isLoading}
        />
        <PharmacyContextCard pharmacyId={entityIds.pharmacy_id} driverId={entityIds.driver_id} />
        <LeaderContextCard pharmacyId={entityIds.pharmacy_id} leaderEntityId={entityIds.leader_id} driverId={entityIds.driver_id} />
        <FinancialMonthCard driverId={entityIds.driver_id} />
        <OperationalContextAccordion ticket={ticket} entityIds={entityIds} conversationId={conversationId} />
        <RoutingExplainAccordion ticket={ticket} conversationId={conversationId} />
        <FinancialSnapshotAccordion ticket={ticket} />
        <TimelineAccordion
          events={timelineQuery.data ?? []}
          loading={timelineQuery.isLoading}
          error={timelineQuery.isError}
        />
        <TicketHistoryCard
          entityIds={entityIds}
          contactId={contactId}
          excludeTicketId={ticket?.id ?? null}
        />
        {aiAccordionFlags ? <AiAnalysisAccordion detail={detail} flags={aiAccordionFlags} /> : null}
      </div>
    </div>
  );
}
