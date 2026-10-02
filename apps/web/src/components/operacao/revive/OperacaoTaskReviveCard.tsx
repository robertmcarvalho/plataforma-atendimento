'use client';

import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock,
  Timer,
  Users,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { OpsHubTaskRow } from '@/lib/ops/opsAnalyticsApi';
import { taskMetaForType } from '@/lib/operacao/operacaoTaskMeta';
import {
  fmtMin,
  formatPrazoLabel,
  resolveRevivePriority,
  resolveReviveTaskStatus,
  revivePrioridadeMeta,
  reviveTaskStatusMeta,
  slaBarColor,
} from '@/lib/operacao/operacaoTaskReviveUtils';
import { cn } from '@/lib/utils';

export function OperacaoTaskReviveCard({
  task,
  selected,
  onSelect,
}: {
  task: OpsHubTaskRow;
  selected?: boolean;
  onSelect: (id: string) => void;
}) {
  const meta = taskMetaForType(task.task_type);
  const checklist = task.checklist || [];
  const doneCount = checklist.filter((c) => c.done).length;
  const checkPct = checklist.length ? Math.round((doneCount / checklist.length) * 100) : 0;
  const reviveStatus = resolveReviveTaskStatus(task);
  const statusMeta = reviveTaskStatusMeta[reviveStatus];
  const prioridade = resolveRevivePriority(task.priority);
  const prioridadeMeta = revivePrioridadeMeta[prioridade];
  const driverName = task.driver_name?.trim() || 'Entregador';
  const elapsed = task.elapsed_minutes ?? 0;
  const slaMin = task.sla_minutes ?? 0;
  const pct = slaMin > 0 ? Math.min(100, Math.round((elapsed / slaMin) * 100)) : 0;
  const slaCor = slaBarColor(reviveStatus, pct);
  const prazo = formatPrazoLabel(task);
  const atendente = task.assignee_name?.trim() || '—';
  const TaskIcon = meta.icon;

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onSelect(task.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(task.id);
        }
      }}
      className={cn(
        'group cursor-pointer border-border py-0 transition-all hover:border-primary/40',
        reviveStatus === 'atrasada' && 'border-destructive/40',
        selected && 'ring-1 ring-primary/30'
      )}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <TaskIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{meta.label}</span>
                <span className={cn('rounded px-1 py-px text-[9px] font-medium', prioridadeMeta.cls)}>
                  {prioridadeMeta.label}
                </span>
              </div>
              <div className="truncate text-sm font-semibold">{driverName}</div>
              <div className="text-[11px] text-muted-foreground">{task.pharmacy_name || '—'}</div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={cn('rounded-md border px-2 py-0.5 text-[10px] font-medium', statusMeta.cls)}>
              {statusMeta.label}
            </span>
            {reviveStatus === 'atrasada' ? (
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" strokeWidth={1.75} />
            ) : null}
          </div>
        </div>

        {checklist.length > 0 ? (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>
                Checklist · {doneCount}/{checklist.length}
              </span>
              <span className="font-mono">{checkPct}%</span>
            </div>
            <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${checkPct}%` }} />
            </div>
            <ul className="space-y-1">
              {checklist.slice(0, 4).map((c) => (
                <li key={c.label} className="flex items-center gap-2 text-[11px]">
                  {c.done ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" strokeWidth={2} />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
                  )}
                  <span className={cn(c.done && 'text-muted-foreground line-through')}>{c.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {slaMin > 0 ? (
          <div className="mt-4 border-t border-border pt-3">
            <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Timer className="h-3 w-3" strokeWidth={1.75} /> SLA {fmtMin(elapsed)} / {fmtMin(slaMin)}
              </span>
              <span className={cn('font-mono', pct >= 100 ? 'font-medium text-destructive' : '')}>{pct}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={cn('h-full transition-all', slaCor)} style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px]">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Users className="h-3 w-3" strokeWidth={1.75} />
                Atendente <span className="font-medium text-foreground">{atendente}</span>
              </span>
              <span className="flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3 w-3" strokeWidth={1.75} /> {prazo}
              </span>
            </div>
          </div>
        ) : (
          <div className="mt-4 border-t border-border pt-3">
            <div className="flex items-center justify-between text-[10px]">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Users className="h-3 w-3" strokeWidth={1.75} />
                Atendente <span className="font-medium text-foreground">{atendente}</span>
              </span>
              <span className="flex items-center gap-1 text-muted-foreground">
                <Clock className="h-3 w-3" strokeWidth={1.75} /> {prazo}
              </span>
            </div>
          </div>
        )}

        <div className="mt-3 flex items-center justify-end gap-1 text-[10px] text-primary opacity-0 transition-opacity group-hover:opacity-100">
          Abrir tarefa <ChevronRight className="h-3 w-3" strokeWidth={2} />
        </div>
      </CardContent>
    </Card>
  );
}
