'use client';

import type { TicketEventRow } from '@/lib/ticketing/types';

export function TimelineAccordion({ events, loading, error }: { events: TicketEventRow[]; loading?: boolean; error?: boolean }) {
  return (
    <details className="inbox-context-accordion">
      <summary className="inbox-context-accordion-summary">
        <span className="inbox-context-title" style={{ marginBottom: 0 }}>
          Timeline do ticket
        </span>
        <span className="inbox-context-chevron">+</span>
      </summary>
      <div className="inbox-stack-list">
        {loading ? <p className="text-xs text-muted-foreground">Carregando eventos…</p> : null}
        {error ? <p className="text-xs text-destructive">Falha ao carregar timeline.</p> : null}
        {!loading && !error && events.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem eventos registrados.</p>
        ) : null}
        {events.map((e) => (
          <div key={e.id} className="inbox-context-section !p-2.5">
            <div className="inbox-context-summary-name text-xs font-medium">{e.event_type}</div>
            <div className="inbox-context-summary-meta mt-0.5 text-[10px] text-muted-foreground">
              {new Date(e.created_at).toLocaleString('pt-BR')}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
