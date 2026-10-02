'use client';

import Link from 'next/link';
import {
  BellRing,
  Building2,
  ChevronRight,
  Clock,
  FileSignature,
  Timer,
} from 'lucide-react';
import { IconTile } from '@/components/ui/IconTile';
import { Skeleton } from '@/components/ui/Skeleton';
import type { ReviveQuickAction } from '@/lib/operacao/reviveCopy/reviveQuickActions';
import type { AlertaOperacional, NotificacaoPendencia } from '@/lib/operacao/reviveCopy/operacaoReviveTypes';
import { cn } from '@/lib/utils';

const nivelCls: Record<AlertaOperacional['nivel'], string> = {
  destructive: 'bg-destructive/15 text-destructive border-destructive/30',
  warning: 'bg-warning/15 text-warning border-warning/30',
  success: 'bg-success/15 text-success border-success/30',
  info: 'bg-primary/15 text-primary border-primary/30',
};

export function ReviveAlertasPanel({
  alertas,
  loading,
  onAlertClick,
}: {
  alertas: AlertaOperacional[];
  loading?: boolean;
  onAlertClick?: (alerta: AlertaOperacional) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <IconTile icon={BellRing} tone="warning" size="sm" /> Alertas operacionais
        </h3>
        <span className="rounded bg-destructive/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-destructive">
          {alertas.filter((a) => a.nivel !== 'success').length}
        </span>
      </div>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {alertas.map((a) => {
            const clickable = Boolean(onAlertClick && (a.acao || a.href));
            return (
            <li
              key={a.id}
              className={cn(
                'rounded-lg border border-border bg-background/40 p-3',
                clickable && 'cursor-pointer transition-colors hover:border-primary/40 hover:bg-sidebar-accent/30',
              )}
              onClick={() => clickable && onAlertClick?.(a)}
              onKeyDown={(e) => {
                if (clickable && (e.key === 'Enter' || e.key === ' ')) onAlertClick?.(a);
              }}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
            >
              <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider', nivelCls[a.nivel])}>
                {a.tipoLabel}
              </span>
              <div className="mt-1 text-xs">{a.descricao}</div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-subtle-foreground">
                <Building2 className="h-3 w-3" strokeWidth={1.75} /> {a.farmacia}
                <Clock className="ml-1 h-3 w-3" strokeWidth={1.75} /> {a.timestamp}
              </div>
            </li>
          );
          })}
        </ul>
      )}
    </div>
  );
}

export function ReviveNotificacoesPanel({
  notificacoes,
  onOpenTarefa,
}: {
  notificacoes: NotificacaoPendencia[];
  onOpenTarefa?: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <IconTile icon={FileSignature} tone="destructive" size="sm" /> Pendências de assinatura
        </h3>
        <span className="rounded bg-warning/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-warning">
          {notificacoes.length}
        </span>
      </div>
      {notificacoes.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground">Sem pendências.</div>
      ) : (
        <ul className="space-y-2">
          {notificacoes.map((n) => {
            const atrasada = n.diasPendente > n.prazoDias;
            const pct = Math.min(100, Math.round((n.diasPendente / n.prazoDias) * 100));
            return (
              <li
                key={n.id}
                className={cn(
                  'rounded-lg border bg-background/40 p-3 transition-colors',
                  atrasada ? 'border-destructive/40' : 'border-border',
                  n.tarefaId && 'cursor-pointer hover:border-primary/40',
                )}
                onClick={() => n.tarefaId && onOpenTarefa?.(n.tarefaId)}
                onKeyDown={(e) => {
                  if (n.tarefaId && (e.key === 'Enter' || e.key === ' ')) onOpenTarefa?.(n.tarefaId);
                }}
                role={n.tarefaId ? 'button' : undefined}
                tabIndex={n.tarefaId ? 0 : undefined}
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-primary text-[10px] font-semibold text-primary-foreground">
                    {n.entregadorIniciais}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{n.entregadorNome}</div>
                    <div className="text-[10px] text-subtle-foreground">{n.farmacia}</div>
                  </div>
                  <span
                    className={cn(
                      'rounded border px-1.5 py-0.5 text-[10px]',
                      n.tipo === 'matricula'
                        ? 'border-warning/30 bg-warning/15 text-warning'
                        : 'border-destructive/30 bg-destructive/15 text-destructive',
                    )}
                  >
                    {n.tipo === 'matricula' ? 'Matrícula' : 'Desligamento'}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Timer className="h-3 w-3" strokeWidth={1.75} /> {n.diasPendente}/{n.prazoDias} dias
                  </span>
                  <span className={atrasada ? 'font-medium text-destructive' : ''}>
                    {atrasada ? 'SLA estourado' : 'No prazo'}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className={cn('h-full transition-all', atrasada ? 'bg-destructive' : 'bg-warning')} style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function QuickActionItem({ action }: { action: ReviveQuickAction }) {
  const Icon = action.icon;
  const inner = (
    <>
      <span className="flex items-center gap-2 text-xs">
        <IconTile icon={Icon} tone={action.tone ?? 'primary'} size="sm" /> {action.label}
      </span>
      <ChevronRight className="h-3 w-3 text-muted-foreground transition-transform group-hover:translate-x-0.5" strokeWidth={1.75} />
    </>
  );
  const className =
    'group flex items-center justify-between rounded-lg border border-border bg-background/40 p-2.5 transition-colors hover:border-primary/40 hover:bg-sidebar-accent/40';

  if (action.href) {
    return (
      <Link href={action.href} className={className}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" className={className} onClick={action.onClick} disabled={!action.onClick}>
      {inner}
    </button>
  );
}

export function ReviveQuickActionsPanel({ actions }: { actions: ReviveQuickAction[] }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <IconTile icon={ChevronRight} tone="primary" size="sm" /> Ações rápidas
      </h3>
      <div className="grid grid-cols-2 gap-2">
        {actions.map((action) => (
          <QuickActionItem key={action.id} action={action} />
        ))}
      </div>
    </div>
  );
}
