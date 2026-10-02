// WIP � feature paused. Flag: ticketingPanel in lib/features.ts
// Do not delete. Context: codebase audit Phase A (ticketing panel soft-pause)

'use client';

import { useEffect, useState } from 'react';
import { StatusDot } from '@/components/ui/StatusDot';
import type { OperationalTicket } from '@/lib/ticketing/types';

type TicketLike = Pick<OperationalTicket, 'status' | 'due_at' | 'sla_minutes'>;

export function SlaBadge({ ticket }: { ticket: TicketLike | null }) {
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    const first = window.setTimeout(tick, 0);
    const interval = window.setInterval(tick, 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, []);

  if (!ticket) return null;
  if (!ticket.due_at) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/50 px-2 py-0.5 text-[10px] text-muted-foreground">
        <StatusDot status="offline" />
        Sem SLA
      </span>
    );
  }
  if (nowMs === null) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/50 px-2 py-0.5 text-[10px] text-muted-foreground">
        <StatusDot status="idle" pulse />
        SLA…
      </span>
    );
  }

  const due = new Date(ticket.due_at).getTime();
  const diffMs = due - nowMs;
  const slaMs = Math.max(1, ticket.sla_minutes) * 60 * 1000;
  const start = due - slaMs;
  const elapsedPct = Math.max(0, Math.min(1, (nowMs - start) / slaMs));

  if (ticket.status === 'overdue' || diffMs <= 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive">
        <StatusDot status="busy" />
        SLA vencido
      </span>
    );
  }

  if (elapsedPct >= 0.8) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/35 bg-warning/10 px-2 py-0.5 text-[10px] text-warning">
        <StatusDot status="idle" pulse />
        Alerta 80%
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] text-success">
      <StatusDot status="online" pulse />
      Dentro do SLA
    </span>
  );
}

