import type { OpsHubTaskRow } from '@/lib/ops/opsAnalyticsApi';
import { formatSlaMinutes } from '@/lib/sla/formatSlaDuration';

export type ReviveTaskStatus = 'em_andamento' | 'atrasada' | 'concluida' | 'aguardando';
export type ReviveTaskPriority = 'alta' | 'media' | 'baixa';

export const reviveTaskStatusMeta: Record<ReviveTaskStatus, { label: string; cls: string }> = {
  em_andamento: { label: 'Em andamento', cls: 'bg-primary/15 text-primary border-primary/30' },
  atrasada: { label: 'Atrasada', cls: 'bg-destructive/15 text-destructive border-destructive/30' },
  concluida: { label: 'Concluída', cls: 'bg-success/15 text-success border-success/30' },
  aguardando: { label: 'Aguardando atendente', cls: 'bg-warning/15 text-warning border-warning/30' },
};

export const revivePrioridadeMeta: Record<ReviveTaskPriority, { label: string; cls: string }> = {
  alta: { label: 'Alta', cls: 'bg-destructive/15 text-destructive' },
  media: { label: 'Média', cls: 'bg-warning/15 text-warning' },
  baixa: { label: 'Baixa', cls: 'bg-muted text-muted-foreground' },
};

export function fmtMin(m: number): string {
  return formatSlaMinutes(m);
}

export function resolveReviveTaskStatus(task: OpsHubTaskRow): ReviveTaskStatus {
  if (task.status === 'done') return 'concluida';
  if (task.status === 'cancelled') return 'concluida';
  const overdue = task.due_at && new Date(task.due_at).getTime() < Date.now();
  if (overdue) return 'atrasada';
  if (task.status === 'open' && !task.assignee_id) return 'aguardando';
  return 'em_andamento';
}

export function resolveRevivePriority(priority: string): ReviveTaskPriority {
  const p = priority.toLowerCase();
  if (p === 'high' || p === 'urgent') return 'alta';
  if (p === 'low') return 'baixa';
  return 'media';
}

export function slaBarColor(status: ReviveTaskStatus, pct: number): string {
  if (status === 'concluida') return 'bg-success';
  if (pct >= 100) return 'bg-destructive';
  if (pct >= 75) return 'bg-warning';
  return 'bg-primary';
}

export function formatPrazoLabel(task: OpsHubTaskRow): string {
  if (task.status === 'done') return 'Concluída';
  if (task.prazo_label) return task.prazo_label;
  if (!task.due_at) return 'Sem prazo';
  const due = new Date(task.due_at);
  const now = new Date();
  const sameDay =
    due.getFullYear() === now.getFullYear() &&
    due.getMonth() === now.getMonth() &&
    due.getDate() === now.getDate();
  const time = due.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `Hoje ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    due.getFullYear() === tomorrow.getFullYear() &&
    due.getMonth() === tomorrow.getMonth() &&
    due.getDate() === tomorrow.getDate();
  if (isTomorrow) return `Amanhã ${time}`;
  return due.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
