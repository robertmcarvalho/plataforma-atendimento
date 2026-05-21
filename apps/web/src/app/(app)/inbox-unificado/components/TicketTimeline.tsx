'use client';

type TicketEvent = {
  id: string;
  event_type: string;
  created_at: string;
};

export function TicketTimeline({ events }: { events: TicketEvent[] }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <p className="mb-2 text-xs text-[var(--text-muted)]">Timeline do ticket</p>
      {!events.length ? <p className="text-sm text-[var(--text-muted)]">Sem eventos.</p> : null}
      <div className="space-y-2">
        {events.map((e) => (
          <div key={e.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
            <p className="text-sm font-medium">{e.event_type}</p>
            <p className="text-xs text-[var(--text-muted)]">{new Date(e.created_at).toLocaleString('pt-BR')}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
