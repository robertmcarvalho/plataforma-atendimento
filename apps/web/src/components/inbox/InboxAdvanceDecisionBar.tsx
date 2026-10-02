'use client';

import { Button } from '@/components/ui/button';

type AdvanceTaskSnapshot = {
  id: string;
  title?: string | null;
  description?: string | null;
  phase?: string;
};

type Props = {
  task: AdvanceTaskSnapshot;
  onApprove: () => void;
  onReject: () => void;
  onOpenEntry?: () => void;
  busy?: boolean;
};

export function InboxAdvanceDecisionBar({ task, onApprove, onReject, onOpenEntry, busy }: Props) {
  const phase = task.phase || 'review';
  const summary = task.description?.trim();

  if (phase === 'rejected' || phase === 'rejection_followup') {
    return (
      <div className="border-b border-border bg-background/40 px-5 py-2.5 text-xs text-muted-foreground">
        Adiantamento reprovado. Demanda encerrada; avise o líder manualmente se necessário (portal ou mensagem).
      </div>
    );
  }

  if (phase === 'awaiting_entry') {
    return (
      <div className="flex flex-col gap-2 border-b border-primary/20 bg-primary/5 px-5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-xs">
          <p className="font-semibold text-foreground">Adiantamento aprovado</p>
          <p className="text-muted-foreground">Registre o lançamento na Inbox; depois encerre a conversa e comunique o líder se precisar.</p>
        </div>
        {onOpenEntry ? (
          <Button type="button" className="shrink-0 text-xs" disabled={busy} onClick={onOpenEntry}>
            Abrir lançamento
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border bg-background px-5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1 text-xs">
        <p className="font-semibold text-foreground">{task.title || 'Solicitação de adiantamento'}</p>
        {summary ? <p className="mt-0.5 line-clamp-2 text-muted-foreground">{summary}</p> : null}
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
          disabled={busy}
          onClick={onReject}
        >
          Reprovar
        </button>
        <Button type="button" className="px-3 py-1.5 text-xs" disabled={busy} onClick={onApprove}>
          Aprovar
        </Button>
      </div>
    </div>
  );
}
