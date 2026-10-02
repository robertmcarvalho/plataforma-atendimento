'use client';

import { formatBRL } from '@/lib/brFormat';
import { formatDateBr } from '@/lib/datetimeBr';
import type { InstallmentPreviewResult } from '@/lib/financial/installmentPreview';

type Props = {
  preview: InstallmentPreviewResult | null;
  totalCount: number;
  showFirstThursday?: boolean;
};

export function AdvanceInstallmentPreview({ preview, totalCount, showFirstThursday = true }: Props) {
  if (!preview) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        Informe a data base do ciclo para calcular as parcelas.
      </div>
    );
  }

  const visible = preview.installments.slice(0, 6);

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
      {showFirstThursday ? (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Data base do ciclo
          </div>
          <div className="font-medium">{formatDateBr(preview.cycleBaseDate)}</div>
          <div className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-primary">
            1ª quinta de desconto
          </div>
          <div className="font-semibold text-primary">
            {formatDateBr(preview.firstDiscountDate)} ({preview.firstDiscountWeekday})
          </div>
        </div>
      ) : null}

      <div>
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">
          Prévia dos descontos
        </div>
        <div className="space-y-1">
          {visible.map((item) => (
            <div key={item.number} className="flex justify-between text-xs">
              <span>
                Parcela {item.number} em {formatDateBr(item.dueDate)}
              </span>
              <span className="font-mono font-medium">{formatBRL(item.amount)}</span>
            </div>
          ))}
        </div>
        {totalCount > visible.length ? (
          <div className="mt-2 text-[10px] text-muted-foreground">
            Exibindo as primeiras {visible.length} parcelas de {totalCount}.
          </div>
        ) : null}
      </div>
    </div>
  );
}
