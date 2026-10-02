'use client';

import { Users } from 'lucide-react';
import { IconTile } from '@/components/ui/IconTile';
import { cn } from '@/lib/utils';

export function ReviveDesempenhoSetorPanel({
  atendentes,
}: {
  atendentes: Array<{ nome: string; iniciais: string; tarefas: number; sla: number }>;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <IconTile icon={Users} tone="primary" size="sm" /> Desempenho do setor
      </h3>
      <ul className="space-y-2 text-xs">
        {atendentes.map((a) => (
          <li key={a.nome} className="flex items-center gap-2 rounded-lg border border-border bg-background/40 p-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-primary text-[10px] font-semibold text-primary-foreground">
              {a.iniciais}
            </div>
            <div className="min-w-0 flex-1 truncate">
              <div className="truncate font-medium">{a.nome}</div>
              <div className="text-[10px] text-muted-foreground">{a.tarefas} tarefas</div>
            </div>
            <span
              className={cn(
                'rounded px-1.5 py-0.5 font-mono text-[10px]',
                a.sla >= 90 ? 'bg-success/15 text-success' : a.sla >= 80 ? 'bg-warning/15 text-warning' : 'bg-destructive/15 text-destructive',
              )}
            >
              {a.sla}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
