'use client';

import { format, parse } from 'date-fns';
import { ChevronRight, Link2 } from 'lucide-react';
import { formatBRL } from '@/lib/brFormat';
import { statusMeta } from '@/lib/financial/financialLabels';
import { financialEntryDisplayStatus } from '@/lib/financial/financialEntryStatus';
import type { CoverageMaps } from '@/lib/financial/financialCoverage';
import { coverageListHint } from '@/lib/financial/financialCoverage';
import { installmentsOnReferenceDate, isOpenInstallmentStatus } from '@/lib/financial/financialInstallments';
import type { ApiEntry } from '@/lib/financial/types';
import {
  reviveTableHeadRowClassName,
  reviveTableRowClassName,
  reviveTableShellClassName,
} from '@/lib/reviveSurfaces';
import { cn } from '@/lib/utils';

export type FinancialTableProps = {
  isLoading: boolean;
  entries: ApiEntry[];
  typeLabels: Record<string, string>;
  selectedCycleStart: string;
  conferenceWeekdayUi: number | null;
  coverageMaps: CoverageMaps;
  onSelectEntry: (entry: ApiEntry) => void;
};

export function FinancialTable({
  isLoading,
  entries,
  typeLabels,
  selectedCycleStart,
  conferenceWeekdayUi,
  coverageMaps,
  onSelectEntry,
}: FinancialTableProps) {
  return (
    <div className={reviveTableShellClassName}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className={reviveTableHeadRowClassName}>
              <th className="px-4 py-3">ID / Tipo</th>
              <th className="px-4 py-3">Entregador</th>
              <th className="px-4 py-3">Farmácia</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Parcelas</th>
              <th className="px-4 py-3">Próx. Vencimento</th>
              <th className="px-4 py-3">Progresso</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {isLoading ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  Sincronizando banco...
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  Nenhum registro encontrado.
                </td>
              </tr>
            ) : (
              entries.map((e) => {
                const displayStatus =
                  e.status === 'draft' && e.rejection_reason ? 'rejected' : e.status;
                const meta = statusMeta[displayStatus] || statusMeta.draft;
                const Icon = meta.icon;
                const instRows = e.financial_installments ?? [];
                const pendingInst = instRows
                  .filter((i) => i.status === 'pending')
                  .sort((a, b) => a.due_date.localeCompare(b.due_date));
                const dueDate = pendingInst[0]?.due_date ?? instRows[0]?.due_date ?? e.start_date;
                const totalInstallments = instRows.length;
                const paidInstallments = instRows.filter((i) => i.status === 'paid').length;
                const progressPercent = totalInstallments
                  ? Math.round((paidInstallments / totalInstallments) * 100)
                  : 0;
                const refPending = installmentsOnReferenceDate(e, selectedCycleStart).some((i) =>
                  isOpenInstallmentStatus(i.status)
                );
                const coverageHint = coverageListHint(e, coverageMaps);

                return (
                  <tr
                    key={e.id}
                    onClick={() => onSelectEntry(e)}
                    className={cn(
                      reviveTableRowClassName,
                      refPending && conferenceWeekdayUi !== null && 'bg-warning/5'
                    )}
                  >
                    <td className="px-4 py-3">
                      <span className="text-[11px] font-bold text-primary uppercase">
                        {typeLabels[e.type] || e.type}
                      </span>
                      {coverageHint ? (
                        <div className="mt-0.5 flex items-center gap-1 text-[9px] text-muted-foreground">
                          <Link2 className="h-2.5 w-2.5 shrink-0" />
                          <span>{coverageHint}</span>
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium">{e.drivers?.name || '—'}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{e.drivers?.cpf || '—'}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground">{e.pharmacies?.trade_name || 'Sem farmácia'}</td>
                    <td className="px-4 py-3 text-right font-mono text-sm font-semibold">
                      {formatBRL(Number(e.total_amount))}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium">
                      {paidInstallments}/{totalInstallments}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs font-medium text-muted-foreground">
                        {format(parse(dueDate, 'yyyy-MM-dd', new Date()), 'dd/MM/yyyy')}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                          <span>{progressPercent}%</span>
                          <span className="text-[10px] font-semibold">
                            {paidInstallments}/{totalInstallments}
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted/40">
                          <div
                            className="h-full rounded-full bg-success transition-all"
                            style={{ width: `${progressPercent}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
                            meta.color
                          )}
                        >
                          <Icon className="h-2.5 w-2.5" />{' '}
                          {financialEntryDisplayStatus(e.status, e.rejection_reason)}
                        </span>
                        {refPending && conferenceWeekdayUi !== null ? (
                          <span className="text-[9px] font-semibold text-warning">Baixa pendente</span>
                        ) : null}
                        {installmentsOnReferenceDate(e, selectedCycleStart).some((i) => i.status === 'paid') ? (
                          <span className="text-[9px] text-muted-foreground">
                            {e.type === 'daily' ? 'Pago no ciclo' : 'Descontado no ciclo'}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-all" />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
