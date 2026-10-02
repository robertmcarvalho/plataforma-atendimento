'use client';

import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Clock, Link2, Loader2 } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { leaderPortalPageApi } from '@/lib/leaderPortal/leaderPortalPageApi';
import {
  formatLeaderAuditItem,
  leaderOccurrenceTypeLabel,
  leaderStatusTone,
} from '@/lib/leaderPortal/leaderFinancialEntries';
import { formatBRL } from '@/lib/brFormat';
import { formatDateBr, formatDateTimeBr } from '@/lib/datetimeBr';
import { cn } from '@/lib/utils';

type LeaderFinancialEntryDrawerProps = {
  entryId: string | null;
  onClose: () => void;
  onOpenEntry?: (entryId: string) => void;
};

export function LeaderFinancialEntryDrawer({ entryId, onClose, onOpenEntry }: LeaderFinancialEntryDrawerProps) {
  const detailQuery = useQuery({
    queryKey: ['leader-portal', 'financial-entry', entryId],
    queryFn: () => leaderPortalPageApi.fetchFinancialEntryDetail(entryId!),
    enabled: Boolean(entryId),
  });

  const entry = detailQuery.data;

  return (
    <Drawer
      open={Boolean(entryId)}
      onClose={onClose}
      title={entry ? leaderOccurrenceTypeLabel(entry) : 'Detalhe do lançamento'}
      subtitle={entry?.driver?.name || undefined}
      eyebrow="Somente leitura"
      widthClassName="max-w-[36rem]"
    >
      {detailQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : detailQuery.error || !entry ? (
        <p className="text-sm text-destructive">Não foi possível carregar o detalhe.</p>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex rounded px-2 py-0.5 text-[11px] font-semibold',
                leaderStatusTone(entry.leader_status),
              )}
            >
              {entry.leader_status_label}
            </span>
            <span className="text-xs text-muted-foreground">
              Enviado em {formatDateTimeBr(entry.created_at)}
            </span>
          </div>

          <dl className="grid gap-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Entregador</dt>
              <dd className="font-medium text-right">{entry.driver?.name || '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Farmácia</dt>
              <dd className="text-right">{entry.pharmacy?.trade_name || '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Data do evento</dt>
              <dd className="font-mono">{entry.event_date ? formatDateBr(entry.event_date) : '—'}</dd>
            </div>
            {entry.shift ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Turno</dt>
                <dd>{entry.shift}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Valor</dt>
              <dd className="font-mono font-semibold">{formatBRL(entry.amount)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">PIX previsto</dt>
              <dd>
                {entry.payment_date ? (
                  <span title={entry.payment_date}>
                    {format(parseISO(entry.payment_date), 'dd/MM/yyyy (EEEE)', { locale: ptBR })}
                  </span>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>

          {entry.notes || entry.description ? (
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
              {entry.description ? <p className="text-foreground">{entry.description}</p> : null}
              {entry.notes ? <p className="mt-1 text-muted-foreground whitespace-pre-wrap">{entry.notes}</p> : null}
            </div>
          ) : null}

          {entry.coverage_of_entry ? (
            <div className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <Link2 className="h-3.5 w-3.5" />
                Falta vinculada
              </div>
              <p className="mt-2 text-sm">
                {entry.coverage_of_entry.driver?.name || 'Entregador'} —{' '}
                {entry.coverage_of_entry.event_date ? formatDateBr(entry.coverage_of_entry.event_date) : '—'}
              </p>
              {onOpenEntry ? (
                <button
                  type="button"
                  onClick={() => onOpenEntry(entry.coverage_of_entry!.id)}
                  className="mt-2 text-xs font-medium text-primary hover:underline"
                >
                  Ver falta vinculada
                </button>
              ) : null}
            </div>
          ) : null}

          {entry.linked_daily_entries.length > 0 ? (
            <div className="rounded-lg border border-border p-3">
              <div className="text-xs font-semibold text-muted-foreground">Diárias de cobertura</div>
              <ul className="mt-2 space-y-2">
                {entry.linked_daily_entries.map((daily) => (
                  <li key={daily.id} className="flex items-center justify-between text-sm">
                    <span>{daily.driver?.name || 'Cobridor'}</span>
                    <span className="font-mono">{formatBRL(daily.amount)}</span>
                    {onOpenEntry ? (
                      <button
                        type="button"
                        onClick={() => onOpenEntry(daily.id)}
                        className="text-xs text-primary hover:underline"
                      >
                        Ver
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {entry.installments.length > 0 ? (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Parcelas</h4>
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                {entry.installments.map((inst) => (
                  <li key={inst.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <span>
                      {inst.due_date ? formatDateBr(inst.due_date) : '—'}{' '}
                      <span className="text-xs text-muted-foreground">({inst.status})</span>
                    </span>
                    <span className="font-mono">{formatBRL(inst.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {entry.audit_timeline.length > 0 ? (
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Histórico
              </div>
              <ul className="mt-2 space-y-2 border-l-2 border-border pl-3">
                {entry.audit_timeline.map((item, idx) => (
                  <li key={`${item.at}-${idx}`} className="text-sm">
                    <span className="text-foreground">{formatLeaderAuditItem(item)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="rounded-md border border-dashed border-border bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground">
            Modo somente leitura — aprovação, baixa e decisões de faturamento são feitas pelo financeiro.
          </p>
        </div>
      )}
    </Drawer>
  );
}
