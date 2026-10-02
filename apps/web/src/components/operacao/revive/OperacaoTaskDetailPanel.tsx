'use client';

import { useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { InboxTaskWorkspace } from '@/components/inbox/InboxTaskWorkspace';
import { operacaoReviveCardShell } from '@/lib/operacao/operacaoReviveTokens';
import { cn } from '@/lib/utils';

export function OperacaoTaskDetailPanel({
  taskId,
  enableFinanceDecisions = false,
  emptyLabel = 'Selecione um card para executar a pendência.',
}: {
  taskId: string | null;
  enableFinanceDecisions?: boolean;
  emptyLabel?: string;
}) {
  const qc = useQueryClient();

  const invalidateOperacao = () => {
    void qc.invalidateQueries({ queryKey: ['ops-analytics'] });
    void qc.invalidateQueries({ queryKey: ['inbox', 'task-context', taskId] });
  };

  const handleDecideAdvance = async (
    id: string,
    decision: 'approved' | 'rejected',
    reason?: string
  ) => {
    await api.patch(`/api/tasks/${id}/decision`, { decision, reason });
    invalidateOperacao();
  };

  return (
    <aside className={cn(operacaoReviveCardShell, 'p-4 lg:sticky lg:top-4 lg:self-start')}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Detalhe da tarefa
      </p>
      {!taskId ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <InboxTaskWorkspace
          taskId={taskId}
          onOpenConversation={(cid) => {
            window.location.href = `/inbox?conversation=${cid}`;
          }}
          onDecideAdvance={
            enableFinanceDecisions
              ? (id, decision, reason) => {
                  void handleDecideAdvance(id, decision, reason);
                }
              : undefined
          }
        />
      )}
    </aside>
  );
}
