'use client';

import { EscalationBadge } from './EscalationBadge';

type Ticket = {
  ticket_code: string;
  type: string;
  priority: string;
  status: string;
  sla_minutes: number;
  due_at: string | null;
};

export function TicketHeader({ ticket }: { ticket: Ticket | null }) {
  if (!ticket) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm text-[var(--text-muted)]">
        Nenhum ticket aberto para esta conversa.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs text-[var(--text-muted)]">Ticket</p>
          <p className="font-medium">{ticket.ticket_code}</p>
        </div>
        <EscalationBadge ticket={ticket} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <Meta label="Tipo" value={ticket.type} />
        <Meta label="Prioridade" value={ticket.priority} />
        <Meta label="Status" value={ticket.status} />
        <Meta label="SLA (min)" value={String(ticket.sla_minutes)} />
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
