import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { initials } from '@/lib/inbox/inboxFormatters';
import type { ApiPendingTask, ApiSlaEventRow } from '@/lib/inbox/types';

export type InboxNotificationKind = 'task' | 'sla';

export type InboxNotificationItem = {
  id: string;
  kind: InboxNotificationKind;
  at: string;
  actorName: string;
  actorInitials: string;
  summary: string;
  taskId?: string;
  taskType?: string;
  conversationId?: string;
  unread: boolean;
};

const TASK_TYPE_LABELS: Record<string, string> = {
  internal_note_mention: 'Menção em nota interna',
  ticket_sla_notification: 'Alerta de SLA do chamado',
  financial_advance_request: 'Adiantamento pendente',
  driver_registration_gap: 'Cadastro incompleto',
  driver_document_expiry: 'Documento próximo do vencimento',
};

function taskSummary(task: ApiPendingTask): string {
  const title = String(task.title || '').trim();
  if (title) return title;
  return TASK_TYPE_LABELS[task.task_type] || 'Pendência operacional';
}

function taskActorName(task: ApiPendingTask): string {
  return (
    String(task.contact?.display_name || '').trim() ||
    String(task.driver?.name || '').trim() ||
    'Operação'
  );
}

function slaSummary(event: ApiSlaEventRow): string {
  const type = String(event.event_type || '').toLowerCase();
  const sector = event.conversations?.sectors?.name;
  if (type.includes('breach') || type.includes('breached')) {
    return sector ? `SLA estourado — ${sector}` : 'SLA estourado';
  }
  if (type.includes('risk') || type.includes('warning')) {
    return sector ? `SLA em risco — ${sector}` : 'SLA em risco';
  }
  return sector ? `Alerta de SLA — ${sector}` : 'Alerta de SLA';
}

function slaActorName(event: ApiSlaEventRow): string {
  return (
    String(event.conversations?.contacts?.display_name || '').trim() ||
    String(event.conversations?.attendant?.name || '').trim() ||
    'Atendimento'
  );
}

export function formatInboxNotificationWhen(iso: string): string {
  try {
    return format(new Date(iso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
  } catch {
    return '—';
  }
}

export function buildInboxNotificationFeed(
  tasks: ApiPendingTask[],
  slaEvents: ApiSlaEventRow[],
  opts: { includeTasks: boolean; includeSla: boolean; seenAt: string | null }
): InboxNotificationItem[] {
  const seenMs = opts.seenAt ? new Date(opts.seenAt).getTime() : 0;
  const items: InboxNotificationItem[] = [];

  if (opts.includeTasks) {
    for (const task of tasks) {
      const at = String(task.created_at || '').trim();
      if (!at) continue;
      const actorName = taskActorName(task);
      items.push({
        id: `task:${task.id}`,
        kind: 'task',
        at,
        actorName,
        actorInitials: initials(actorName),
        summary: taskSummary(task),
        taskId: task.id,
        taskType: task.task_type,
        conversationId: task.conversation_id || undefined,
        unread: new Date(at).getTime() > seenMs,
      });
    }
  }

  if (opts.includeSla) {
    for (const event of slaEvents) {
      const at = String(event.created_at || '').trim();
      if (!at) continue;
      const actorName = slaActorName(event);
      const conversationId = event.conversations?.id;
      items.push({
        id: `sla:${event.id}`,
        kind: 'sla',
        at,
        actorName,
        actorInitials: initials(actorName),
        summary: slaSummary(event),
        conversationId: conversationId || undefined,
        unread: new Date(at).getTime() > seenMs,
      });
    }
  }

  return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 30);
}

export function countUnreadNotifications(items: InboxNotificationItem[]): number {
  return items.filter((i) => i.unread).length;
}
