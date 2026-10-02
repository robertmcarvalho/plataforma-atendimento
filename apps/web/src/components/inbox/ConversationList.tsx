'use client';

import { Plus } from 'lucide-react';
import { InboxConversationRow } from '@/components/inbox/InboxConversationRow';
import { ToolbarSelect } from '@/components/form/ToolbarSelect';
import { Button } from '@/components/ui/button';
import { conversationListAiBadges, taskStatusLabelPt, ticketStatusLabelPt } from '@/lib/inbox/inboxFormatters';
import { INBOX_COLUMN_HEADER_CLASS } from '@/lib/inbox/inboxColumnHeader';
import type { ApiOperationalTicket, ApiPendingTask, FolderKey, UiConversation } from '@/lib/inbox/types';
import {
  interactiveRowPrimary,
  interactiveRowSecondary,
  interactiveRowSurface,
  semanticPillClass,
} from '@/lib/interactiveRow';
import { features } from '@/lib/features';
import { supervisorTaskTypeFilterOptions } from '@/lib/operacao/taskFilterOptions';
import { cn } from '@/lib/utils';

type FolderRow = { key: FolderKey | 'pending_tasks'; label: string; count: number };

export type ConversationListProps = {
  isSupervisor: boolean;
  supervisorMainTab: 'conversations' | 'tasks' | 'tickets';
  onSupervisorMainTabChange: (tab: 'conversations' | 'tasks' | 'tickets') => void;
  folder: FolderKey;
  folders: FolderRow[];
  filteredConversations: UiConversation[];
  unreadCount: number;
  activeId: string;
  onSelectConversation: (id: string) => void;
  isConvsLoading: boolean;
  isConvsError: boolean;
  onRefreshConversations: () => void;
  canStartStaffConversation: boolean;
  onNewConversation: () => void;
  supervisorTaskStatus: 'all' | 'open' | 'in_progress' | 'done' | 'cancelled';
  onSupervisorTaskStatusChange: (v: 'all' | 'open' | 'in_progress' | 'done' | 'cancelled') => void;
  supervisorTaskType: string;
  onSupervisorTaskTypeChange: (v: string) => void;
  supervisorTicketStatus: 'all' | 'open' | 'in_progress' | 'overdue' | 'resolved';
  onSupervisorTicketStatusChange: (v: 'all' | 'open' | 'in_progress' | 'overdue' | 'resolved') => void;
  supervisorTasksPanel: ApiPendingTask[];
  supervisorTicketsPanel: ApiOperationalTicket[];
  nowTick: number;
  aiSentimentEnabled: boolean;
  aiUrgencyEnabled: boolean;
};

export function ConversationList({
  isSupervisor,
  supervisorMainTab,
  onSupervisorMainTabChange,
  folder,
  folders,
  filteredConversations,
  unreadCount,
  activeId,
  onSelectConversation,
  isConvsLoading,
  isConvsError,
  onRefreshConversations,
  canStartStaffConversation,
  onNewConversation,
  supervisorTaskStatus,
  onSupervisorTaskStatusChange,
  supervisorTaskType,
  onSupervisorTaskTypeChange,
  supervisorTicketStatus,
  onSupervisorTicketStatusChange,
  supervisorTasksPanel,
  supervisorTicketsPanel,
  nowTick,
  aiSentimentEnabled,
  aiUrgencyEnabled,
}: ConversationListProps) {
  const headerTitle =
    !isSupervisor || supervisorMainTab === 'conversations'
      ? folders.find((f) => f.key === folder)?.label || 'Caixa de entrada'
      : supervisorMainTab === 'tasks'
        ? 'Pendências do setor'
        : 'Tickets do setor';

  const headerSubtitle =
    !isSupervisor || supervisorMainTab === 'conversations'
      ? `${filteredConversations.length} conversas · ${unreadCount} não lidas`
      : supervisorMainTab === 'tasks'
        ? `${supervisorTasksPanel.length} pendências`
        : `${supervisorTicketsPanel.length} tickets`;

  return (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border bg-surface/50">
      <div className={INBOX_COLUMN_HEADER_CLASS}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold tracking-tight">{headerTitle}</div>
          <div className="truncate font-mono inbox-t-meta text-muted-foreground">{headerSubtitle}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {canStartStaffConversation ? (
            <Button size="xs" className="inbox-t-meta font-semibold" onClick={onNewConversation}>
              <Plus className="h-3 w-3" />
              <span className="hidden sm:inline">Nova</span>
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="xs"
            className="inbox-t-meta"
            onClick={() => void onRefreshConversations()}
            data-testid="inbox-refresh"
          >
            <span className="hidden sm:inline">Refresh</span>
            <span className="sm:hidden">Atualizar</span>
          </Button>
        </div>
      </div>

      {isSupervisor ? (
        <div className="shrink-0 space-y-2 border-b border-border px-4 py-1.5">
          <div className="flex flex-wrap gap-1">
            {(
              [
                { key: 'conversations' as const, label: 'Atendimentos' },
                { key: 'tasks' as const, label: 'Pendências' },
                { key: 'tickets' as const, label: 'Tickets' },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => onSupervisorMainTabChange(t.key)}
                className={cn(
                  'rounded-md px-2 py-1 inbox-t-meta font-medium transition-colors',
                  supervisorMainTab === t.key
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-surface text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {supervisorMainTab === 'tasks' ? (
            <div className="space-y-2">
              <ToolbarSelect
                value={supervisorTaskStatus}
                onChange={(v) => onSupervisorTaskStatusChange(v as ConversationListProps['supervisorTaskStatus'])}
                className="inbox-t-meta w-full"
                options={[
                  { value: 'all', label: 'Pendências · todos' },
                  { value: 'open', label: taskStatusLabelPt('open') },
                  { value: 'in_progress', label: taskStatusLabelPt('in_progress') },
                  { value: 'done', label: taskStatusLabelPt('done') },
                  { value: 'cancelled', label: taskStatusLabelPt('cancelled') },
                ]}
              />
              <ToolbarSelect
                value={supervisorTaskType}
                onChange={onSupervisorTaskTypeChange}
                className="inbox-t-meta w-full"
                options={supervisorTaskTypeFilterOptions()}
              />
            </div>
          ) : null}

          {supervisorMainTab === 'tickets' ? (
            <ToolbarSelect
              value={supervisorTicketStatus}
              onChange={(v) => onSupervisorTicketStatusChange(v as ConversationListProps['supervisorTicketStatus'])}
              className="inbox-t-meta w-full"
              options={[
                { value: 'all', label: 'Tickets · todos' },
                { value: 'open', label: ticketStatusLabelPt('open') },
                { value: 'in_progress', label: ticketStatusLabelPt('in_progress') },
                { value: 'overdue', label: ticketStatusLabelPt('overdue') },
                { value: 'resolved', label: ticketStatusLabelPt('resolved') },
              ]}
            />
          ) : null}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        {isSupervisor && supervisorMainTab === 'tasks' ? (
          supervisorTasksPanel.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">Nenhuma pendência no filtro atual.</div>
          ) : (
            supervisorTasksPanel.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => {
                  if (task.conversation_id) {
                    onSupervisorMainTabChange('conversations');
                    onSelectConversation(task.conversation_id);
                  }
                }}
                className={cn('flex w-full flex-col gap-0.5 border-b border-border/60 px-4 py-3 text-left', interactiveRowSurface())}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn('truncate text-xs font-semibold', interactiveRowPrimary())}>{task.title}</span>
                  <span className={cn('shrink-0 inbox-t-meta', semanticPillClass('neutral'))}>
                    {taskStatusLabelPt(task.status)}
                  </span>
                </div>
                {task.due_at ? (
                  <span className={cn('font-mono inbox-t-meta', 'text-muted-foreground')}>Prazo · {task.due_at}</span>
                ) : null}
                {task.conversation_id ? (
                  <span className="inbox-t-meta text-primary group-hover:text-sidebar-accent-foreground">Abrir conversa →</span>
                ) : (
                  <span className={cn('inbox-t-meta', interactiveRowSecondary())}>Sem conversa vinculada</span>
                )}
              </button>
            ))
          )
        ) : isSupervisor && supervisorMainTab === 'tickets' ? (
          supervisorTicketsPanel.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">Nenhum ticket no filtro atual.</div>
          ) : (
            supervisorTicketsPanel.map((tk) => (
              <button
                key={tk.id}
                type="button"
                onClick={() => {
                  if (tk.conversation_id) {
                    onSupervisorMainTabChange('conversations');
                    onSelectConversation(tk.conversation_id);
                  }
                }}
                className={cn('flex w-full flex-col gap-0.5 border-b border-border/60 px-4 py-3 text-left', interactiveRowSurface())}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn('truncate text-xs font-semibold', interactiveRowPrimary())}>
                    {tk.ticket_code || tk.id}
                  </span>
                  <span className={cn('shrink-0 inbox-t-meta', semanticPillClass('neutral'))}>
                    {ticketStatusLabelPt(tk.status)}
                  </span>
                </div>
                {tk.type ? <span className={cn('inbox-t-meta', interactiveRowSecondary())}>Tipo · {tk.type}</span> : null}
                {tk.conversation_id ? <span className="inbox-t-meta text-primary">Abrir conversa →</span> : null}
              </button>
            ))
          )
        ) : isConvsLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
        ) : isConvsError ? (
          <div className="p-6 text-sm text-muted-foreground">
            Falha ao carregar conversas.
            <button type="button" onClick={() => void onRefreshConversations()} className="ml-2 text-primary hover:underline">
              Tentar novamente
            </button>
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">Nenhuma conversa.</div>
        ) : (
          filteredConversations.map((c) => {
            const listAi = conversationListAiBadges(c.raw);
            return (
              <InboxConversationRow
                key={c.id}
                conversation={c}
                active={activeId === c.id}
                isSupervisor={isSupervisor}
                showAiSentiment={Boolean(features.aiAnalysisBadges && aiSentimentEnabled)}
                showAiUrgency={Boolean(features.aiAnalysisBadges && aiUrgencyEnabled)}
                listAi={listAi}
                nowMs={nowTick}
                onSelect={() => onSelectConversation(c.id)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
