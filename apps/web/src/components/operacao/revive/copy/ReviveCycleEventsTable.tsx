'use client';

import { AlertTriangle, Building2, Clock, FileSignature, UserMinus, UserPlus } from 'lucide-react';
import { AvatarInitials } from '@/components/ui/AvatarInitials';
import { Skeleton } from '@/components/ui/Skeleton';
import type { EventoCiclo } from '@/lib/operacao/reviveCopy/operacaoReviveTypes';
import { cn } from '@/lib/utils';

const statusMeta: Record<EventoCiclo['status'], { label: string; cls: string }> = {
  concluido: { label: 'Concluído', cls: 'bg-success/15 text-success border-success/30' },
  em_andamento: { label: 'Em andamento', cls: 'bg-primary/15 text-primary border-primary/30' },
  pendente: { label: 'Pendente', cls: 'bg-warning/15 text-warning border-warning/30' },
};

function settlementLabel(e: EventoCiclo): string {
  if (e.diasAcertoRestantes == null) return '—';
  if (e.diasAcertoRestantes <= 0) return 'Vencido';
  return `${e.diasAcertoRestantes}d úteis`;
}

function assinaturaCls(label: string | null | undefined): string {
  const s = String(label || '').toLowerCase();
  if (s.includes('assinado') && !s.includes('aguardando') && !s.includes('cooperativa')) {
    return 'border-success/30 bg-success/15 text-success';
  }
  if (s.includes('recusado')) return 'border-destructive/30 bg-destructive/15 text-destructive';
  return 'border-warning/30 bg-warning/15 text-warning';
}

export function ReviveCycleEventsTable({
  eventos,
  loading,
  filter = 'todos',
  financeiro = false,
}: {
  eventos: EventoCiclo[];
  loading?: boolean;
  filter?: 'todos' | 'entrada' | 'desligamento';
  financeiro?: boolean;
}) {
  const items = filter === 'todos' ? eventos : eventos.filter((e) => e.tipo === filter);
  const colSpan = financeiro ? 9 : 7;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="max-h-[360px] overflow-x-auto overflow-y-auto">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="sticky top-0 bg-background/80 text-[10px] uppercase tracking-wider text-subtle-foreground backdrop-blur">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Tipo</th>
              <th className="px-2 py-2 text-left font-medium">Entregador</th>
              <th className="px-2 py-2 text-left font-medium">Último dia / Início</th>
              <th className="px-2 py-2 text-left font-medium">Farmácia</th>
              <th className="px-2 py-2 text-left font-medium">Líder</th>
              <th className="px-2 py-2 text-left font-medium">Atendente</th>
              {financeiro ? (
                <>
                  <th className="px-2 py-2 text-left font-medium">Assinatura</th>
                  <th className="px-2 py-2 text-left font-medium">Acerto</th>
                </>
              ) : null}
              <th className="min-w-[96px] px-4 py-2 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={colSpan} className="p-2">
                      <Skeleton className="h-8 rounded" />
                    </td>
                  </tr>
                ))
              : items.length === 0
                ? (
                    <tr>
                      <td colSpan={colSpan} className="px-4 py-8 text-center text-muted-foreground">
                        Nenhum evento no ciclo.
                      </td>
                    </tr>
                  )
                : items.map((e) => (
                    <tr
                      key={e.id}
                      className={cn(
                        'border-t border-border hover:bg-background/40',
                        e.riscoSubstituicao && 'bg-warning/5',
                      )}
                    >
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          {e.tipo === 'entrada' ? (
                            <UserPlus className="h-3.5 w-3.5 text-success" strokeWidth={1.75} />
                          ) : (
                            <UserMinus className="h-3.5 w-3.5 text-destructive" strokeWidth={1.75} />
                          )}
                          <span className="text-[11px] font-medium">{e.tipo === 'entrada' ? 'Entrada' : 'Desligamento'}</span>
                          {e.riscoSubstituicao ? (
                            <span title="Possível substituição na mesma farmácia" className="text-warning">
                              <AlertTriangle className="h-3 w-3" strokeWidth={1.75} />
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <AvatarInitials initials={e.entregadorIniciais} size="sm" className="bg-primary" />
                          <span className="font-medium">{e.entregadorNome}</span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" strokeWidth={1.75} /> {e.data}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Building2 className="h-3 w-3" strokeWidth={1.75} /> {e.farmacia}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">{e.liderNome}</td>
                      <td className="px-2 py-2 text-muted-foreground">{e.atendenteNome}</td>
                      {financeiro ? (
                        <>
                          <td className="px-2 py-2">
                            {e.assinaturaTermo ? (
                              <span
                                className={cn(
                                  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
                                  assinaturaCls(e.assinaturaTermo),
                                )}
                              >
                                <FileSignature className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                                {e.assinaturaTermo}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="px-2 py-2">
                            {e.tipo === 'desligamento' && e.prazoAcerto ? (
                              <span
                                className={cn(
                                  'text-[11px] font-medium',
                                  e.diasAcertoRestantes != null && e.diasAcertoRestantes <= 0
                                    ? 'text-destructive'
                                    : 'text-muted-foreground',
                                )}
                              >
                                {e.prazoAcerto} · {settlementLabel(e)}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                        </>
                      ) : null}
                      <td className="whitespace-nowrap px-4 py-2 text-right">
                        <span
                          className={cn(
                            'inline-flex whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
                            statusMeta[e.status].cls,
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
