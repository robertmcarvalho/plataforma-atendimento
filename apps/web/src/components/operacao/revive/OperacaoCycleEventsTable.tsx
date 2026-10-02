'use client';

import { Building2, Clock, UserMinus, UserPlus } from 'lucide-react';
import { AvatarInitials } from '@/components/ui/AvatarInitials';
import type { OpsCycleEventRow } from '@/lib/ops/opsAnalyticsApi';
import { cn } from '@/lib/utils';

const statusMeta: Record<OpsCycleEventRow['status'], { label: string; cls: string }> = {
  concluido: { label: 'Concluído', cls: 'bg-success/15 text-success border-success/30' },
  em_andamento: { label: 'Em andamento', cls: 'bg-primary/15 text-primary border-primary/30' },
  pendente: { label: 'Pendente', cls: 'bg-warning/15 text-warning border-warning/30' },
};

export function OperacaoCycleEventsTable({
  eventos,
  loading,
  filter = 'todos',
}: {
  eventos: OpsCycleEventRow[];
  loading?: boolean;
  filter?: 'todos' | 'entrada' | 'desligamento';
}) {
  const items = filter === 'todos' ? eventos : eventos.filter((e) => e.tipo === filter);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="max-h-[360px] overflow-x-auto overflow-y-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="sticky top-0 bg-background/80 text-[10px] uppercase tracking-wider text-muted-foreground backdrop-blur">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Tipo</th>
              <th className="px-2 py-2 text-left font-medium">Entregador</th>
              <th className="px-2 py-2 text-left font-medium">Último dia / Início</th>
              <th className="px-2 py-2 text-left font-medium">Farmácia</th>
              <th className="px-2 py-2 text-left font-medium">Líder</th>
              <th className="px-2 py-2 text-left font-medium">Atendente</th>
              <th className="px-4 py-2 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={7} className="p-2">
                      <div className="h-8 animate-pulse rounded bg-muted" />
                    </td>
                  </tr>
                ))
              : items.length === 0
                ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        Nenhum evento no ciclo.
                      </td>
                    </tr>
                  )
                : items.map((e) => (
                    <tr key={e.id} className="border-t border-border hover:bg-background/40">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          {e.tipo === 'entrada' ? (
                            <UserPlus className="h-3.5 w-3.5 text-success" strokeWidth={1.75} />
                          ) : (
                            <UserMinus className="h-3.5 w-3.5 text-destructive" strokeWidth={1.75} />
                          )}
                          <span className="text-[11px] font-medium">
                            {e.tipo === 'entrada' ? 'Entrada' : 'Desligamento'}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <AvatarInitials initials={e.driver_initials} size="sm" className="bg-primary" />
                          <span className="font-medium">{e.driver_name}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" strokeWidth={1.75} /> {e.data}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Building2 className="h-3 w-3" strokeWidth={1.75} /> {e.pharmacy_name}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">{e.leader_name}</td>
                      <td className="px-2 py-2 text-muted-foreground">{e.attendant_name}</td>
                      <td className="px-4 py-2 text-right">
                        <span
                          className={cn(
                            'rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
                            statusMeta[e.status].cls
                          )}
                        >
                          {statusMeta[e.status].label}
                        </span>
                      </td>
                    </tr>
                  ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
