'use client';

import { useEffect, useState } from 'react';

type TicketLike = {
  status: string;
  due_at: string | null;
};

export function EscalationBadge({ ticket }: { ticket: TicketLike | null }) {
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
  if (!ticket.due_at) return <span className="text-xs text-[var(--text-muted)]">Sem SLA</span>;
  if (nowMs === null) {
    return (
      <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
        SLA em andamento
      </span>
    );
  }

  const due = new Date(ticket.due_at).getTime();
  const diffMs = due - nowMs;
  const totalWindowMs = 120 * 60 * 1000;
  const elapsedPct = Math.max(0, Math.min(1, (totalWindowMs - diffMs) / totalWindowMs));

  if (ticket.status === 'overdue' || diffMs <= 0) {
    return (
      <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs text-red-300">SLA vencido</span>
    );
  }

  if (elapsedPct >= 0.8) {
    return (
      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">
        Alerta 80%
      </span>
    );
  }

  return <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">Dentro do SLA</span>;
}
