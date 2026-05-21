'use client';

type Ticket = {
  context_snap?: Record<string, unknown> | null;
};

export function FinancialContextCard({ ticket }: { ticket: Ticket | null }) {
  const snap = ticket?.context_snap;
  if (!snap) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm text-[var(--text-muted)]">
        Sem snapshot financeiro disponível.
      </div>
    );
  }

  const pretty = JSON.stringify(snap, null, 2);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
      <p className="mb-2 text-xs text-[var(--text-muted)]">Contexto financeiro congelado na abertura</p>
      <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-xs">
        {pretty}
      </pre>
    </div>
  );
}
