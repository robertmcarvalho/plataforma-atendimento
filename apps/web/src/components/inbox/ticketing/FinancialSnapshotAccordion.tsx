'use client';

import type { OperationalTicket } from '@/lib/ticketing/types';

export function FinancialSnapshotAccordion({ ticket }: { ticket: OperationalTicket | null }) {
  const snap = ticket?.context_snap;
  const hasSnap = snap && typeof snap === 'object' && Object.keys(snap as object).length > 0;

  return (
    <details className="inbox-context-accordion">
      <summary className="inbox-context-accordion-summary">
        <span className="inbox-context-title" style={{ marginBottom: 0 }}>
          Contexto financeiro
        </span>
        <span className="inbox-context-chevron">+</span>
      </summary>
      {!hasSnap ? (
        <p className="text-xs text-muted-foreground">Sem contexto financeiro disponível na abertura do ticket.</p>
      ) : (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background/40 p-2 font-mono text-[10px] text-muted-foreground">
          {JSON.stringify(snap, null, 2)}
        </pre>
      )}
    </details>
  );
}
