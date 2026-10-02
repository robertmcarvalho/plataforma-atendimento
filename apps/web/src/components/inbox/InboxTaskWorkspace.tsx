'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { InboxAdvanceEntryDrawer, type AdvanceEntryPrefill } from './InboxAdvanceEntryDrawer';
import { InboxDriverRegistrationForm } from './InboxDriverRegistrationForm';

type TaskContext = {
  task: { id: string; task_type: string; title?: string; status?: string; driver_id?: string | null; conversation_id?: string | null; metadata?: Record<string, unknown> };
  playbook: { steps: Array<{ id: string; label: string }>; current_step: string };
  advance_context?: {
    open_advance_count: number;
    open_advances?: Array<{ start_date: string; total_amount: number }>;
    month_summary?: { total_debits: number; pending_installments_amount: number; net_estimated: number };
    alerts: Array<{ message: string; severity: string }>;
    recommended_max_amount?: number;
    requested_amount?: number;
  };
  financial_review_context?: {
    recent_entries?: Array<{ type: string; status: string; total_amount: number; start_date: string }>;
    week_summary?: Record<string, unknown>;
  };
  registration_context?: {
    missing_required: Array<{ key: string; label: string }>;
    completion_percent: number;
  };
  entry_prefill?: AdvanceEntryPrefill;
  entities?: { driver?: { name?: string } };
};

type Props = {
  taskId: string | null;
  onOpenConversation: (conversationId: string) => void;
  onDecideAdvance?: (taskId: string, decision: 'approved' | 'rejected', reason?: string) => void;
};

function formatBrl(n: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

function FinancialReviewCard({
  advance,
  review,
  showDecisions,
  onReject,
  onApprove,
}: {
  advance: NonNullable<TaskContext['advance_context']>;
  review?: TaskContext['financial_review_context'];
  showDecisions: boolean;
  onReject?: () => void;
  onApprove?: () => void;
}) {
  const discounts = (review?.recent_entries || []).filter((e) => e.type !== 'advance' && e.type !== 'daily');
  return (
    <Card size="sm" className="gap-2 py-3 text-xs ring-0">
      <CardContent className="space-y-2 px-3 pt-0">
      <p className="font-semibold text-foreground">Situação financeira do entregador</p>
      <p>Adiantamentos em aberto: {advance.open_advance_count}</p>
      {(advance.open_advances || []).map((a, i) => (
        <p key={i} className="text-muted-foreground">
          · {a.start_date}: {formatBrl(a.total_amount)}
        </p>
      ))}
      {advance.month_summary ? (
        <p className="text-muted-foreground">
          Mês: débitos {formatBrl(advance.month_summary.total_debits)} · líquido{' '}
          {formatBrl(advance.month_summary.net_estimated)}
        </p>
      ) : null}
      {discounts.length ? (
        <div>
          <p className="mt-1 font-medium text-foreground">Descontos / ocorrências recentes</p>
          {discounts.slice(0, 6).map((e, i) => (
            <p key={i} className="text-muted-foreground">
              · {e.start_date} {e.type} ({e.status}) {formatBrl(e.total_amount)}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground">Sem descontos recentes além de adiantamentos.</p>
      )}
      {advance.alerts?.map((a, i) => (
        <p key={i} className={a.severity === 'block' ? 'text-destructive' : 'text-amber-600'}>
          {a.message}
        </p>
      ))}
      {showDecisions && onReject && onApprove ? (
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" className="flex-1 text-xs" onClick={onReject}>
            Reprovar
          </Button>
          <Button type="button" className="flex-1 text-xs" onClick={onApprove}>
            Aprovar
          </Button>
        </div>
      ) : null}
      </CardContent>
    </Card>
  );
}

export function InboxTaskWorkspace({ taskId, onOpenConversation, onDecideAdvance }: Props) {
  const qc = useQueryClient();
  const [entryOpen, setEntryOpen] = useState(false);

  const invalidateTask = () => {
    void qc.invalidateQueries({ queryKey: ['inbox', 'task-context', taskId] });
    void qc.invalidateQueries({ queryKey: ['inbox', 'pending-tasks-list'] });
    void qc.invalidateQueries({ queryKey: ['inbox', 'tasks-summary'] });
    void qc.invalidateQueries({ queryKey: ['inbox', 'activity-tasks'] });
    void qc.invalidateQueries({ queryKey: ['ops-analytics'] });
  };

  const { data, isLoading } = useQuery({
    queryKey: ['inbox', 'task-context', taskId],
    enabled: Boolean(taskId),
    queryFn: async () => (await api.get(`/api/tasks/${taskId}/context`)).data as TaskContext,
  });

  const task = data?.task;
  const meta = (task?.metadata || {}) as Record<string, unknown>;
  const phase = String(meta.phase || '');

  useEffect(() => {
    if (phase === 'awaiting_entry' && data?.entry_prefill) {
      setEntryOpen(true);
    }
  }, [phase, data?.entry_prefill, taskId]);

  if (!taskId) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">Selecione uma pendência na lista.</p>;
  }
  if (isLoading) return <p className="px-4 py-6 text-sm text-muted-foreground">Carregando tarefa…</p>;
  if (!data || !task) return null;

  const driverId = task.driver_id || '';
  const defaultAmount =
    Number(data.advance_context?.requested_amount || meta.amount || data.advance_context?.recommended_max_amount || 0) ||
    undefined;

  const handleReject = () => {
    const reason = window.prompt('Informe o motivo da reprovação:');
    if (!reason?.trim() || !onDecideAdvance) return;
    onDecideAdvance(task.id, 'rejected', reason.trim());
  };

  return (
    <div className="space-y-4 border-b border-border px-4 py-4">
      <div>
        <h4 className="text-sm font-semibold">{task.title || task.task_type}</h4>
        <ul className="mt-2 space-y-1">
          {data.playbook.steps.map((s) => {
            const progress = Array.isArray(meta.playbook_progress)
              ? (meta.playbook_progress as Array<{ id?: string; done?: boolean }>)
              : [];
            const done = progress.find((p) => p.id === s.id)?.done ?? false;
            return (
              <li key={s.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                <button
                  type="button"
                  className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                  onClick={() => {
                    void api
                      .patch(`/api/tasks/${task.id}/playbook-progress`, { step_id: s.id, done: !done })
                      .then(invalidateTask);
                  }}
                >
                  {done ? '✓' : '○'}
                </button>
                <span className={done ? 'text-foreground line-through opacity-70' : ''}>{s.label}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {task.conversation_id ? (
        <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => onOpenConversation(task.conversation_id!)}>
          Abrir conversa vinculada
        </button>
      ) : null}

      {phase === 'rejected' || phase === 'rejection_followup' ? (
        <p className="rounded-lg border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
          Reprovado pelo gestor financeiro. A conversa foi encerrada; o líder acompanha pelo portal do líder.
        </p>
      ) : null}

      {(task.task_type === 'financial_advance_request' || task.task_type === 'guided_demand') && data.advance_context ? (
        <FinancialReviewCard
          advance={data.advance_context}
          review={data.financial_review_context}
          showDecisions={
            task.task_type === 'financial_advance_request' &&
            phase !== 'awaiting_entry' &&
            phase !== 'rejected' &&
            phase !== 'rejection_followup' &&
            Boolean(onDecideAdvance)
          }
          onReject={onDecideAdvance ? handleReject : undefined}
          onApprove={onDecideAdvance ? () => onDecideAdvance(task.id, 'approved') : undefined}
        />
      ) : null}

      {phase === 'awaiting_entry' && data.entry_prefill ? (
        <>
          <Button type="button" className="w-full text-xs" onClick={() => setEntryOpen(true)}>
            Abrir lançamento financeiro
          </Button>
          <InboxAdvanceEntryDrawer
            open={entryOpen}
            taskId={task.id}
            prefill={data.entry_prefill}
            defaultAmount={defaultAmount}
            onClose={() => setEntryOpen(false)}
            onDone={invalidateTask}
          />
        </>
      ) : null}

      {task.task_type === 'driver_registration_completion' && data.registration_context && driverId ? (
        <InboxDriverRegistrationForm
          driverId={driverId}
          taskId={task.id}
          missingRequired={data.registration_context.missing_required || []}
          onSaved={invalidateTask}
        />
      ) : null}
    </div>
  );
}
