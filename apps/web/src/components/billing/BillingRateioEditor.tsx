'use client';

import { useMemo, useState } from 'react';
import { Calculator, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { BillingEmptyState } from '@/components/billing/BillingPrimitives';
import { cn } from '@/lib/utils';
import { billingSegmentButton, billingSegmentShellClassName } from '@/lib/billing/billingReviveUi';
import type { BillingCostCenter } from '@/lib/billing/billingApi';
import {
  divideEqual,
  recalcFromAmount,
  recalcFromPercent,
  validateRateio,
  type RateioLine,
} from '@/lib/billing/billingRateio';

type Modo = 'igual' | 'manual_pct' | 'manual_valor';

type Props = {
  totalCents: number;
  costCenters: BillingCostCenter[];
  value: RateioLine[];
  onChange: (lines: RateioLine[]) => void;
};

export function BillingRateioEditor({ totalCents, costCenters, value, onChange }: Props) {
  const [modo, setModo] = useState<Modo>(value.length ? 'manual_pct' : 'igual');
  const validacao = useMemo(() => validateRateio(value, totalCents), [value, totalCents]);
  const activeCcs = costCenters.filter((c) => c.active);

  const aplicarModo = (m: Modo) => {
    setModo(m);
    if (m === 'igual') {
      const ids = value.length ? value.map((v) => v.cost_center_id) : activeCcs.map((c) => c.id);
      onChange(divideEqual(totalCents, ids));
    }
  };

  const addLinha = () => {
    const cc = activeCcs.find((c) => !value.some((v) => v.cost_center_id === c.id)) || activeCcs[0];
    if (!cc) return;
    onChange([...value, { cost_center_id: cc.id, percent: 0, amount_cents: 0 }]);
  };

  const remLinha = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  const setLinha = (i: number, patch: Partial<RateioLine>) => {
    const next = value.map((it, idx) => (idx === i ? { ...it, ...patch } : it));
    if (modo === 'manual_pct' && patch.percent !== undefined) onChange(recalcFromPercent(next, totalCents));
    else if (modo === 'manual_valor' && patch.amount_cents !== undefined) onChange(recalcFromAmount(next, totalCents));
    else onChange(next);
  };

  if (!activeCcs.length) {
    return (
      <BillingEmptyState className="py-4">
        Cadastre centros de custo em Configurações para usar rateio.
      </BillingEmptyState>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
          <Calculator className="h-3.5 w-3.5" /> Rateio por centro de custo
        </div>
        <div className={billingSegmentShellClassName}>
          {(['igual', 'manual_pct', 'manual_valor'] as Modo[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => aplicarModo(m)}
              className={billingSegmentButton(modo === m)}
            >
              {m === 'igual' ? '% igual' : m === 'manual_pct' ? '% manual' : 'R$ manual'}
            </button>
          ))}
        </div>
      </div>

      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase text-subtle-foreground">
          <tr>
            <th className="py-1.5 text-left">Centro de custo</th>
            <th className="py-1.5 text-right">%</th>
            <th className="py-1.5 text-right">Valor (R$)</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {value.map((it, i) => (
            <tr key={`${it.cost_center_id}-${i}`} className="border-t border-border/60">
              <td className="py-1.5 pr-2">
                <FormSelect
                  className="w-full"
                  size="sm"
                  value={it.cost_center_id}
                  onChange={(next) => setLinha(i, { cost_center_id: next })}
                  options={activeCcs.map((c) => ({ value: c.id!, label: c.name }))}
                />
              </td>
              <td className="py-1.5 pl-2 text-right">
                <FormControl
                  type="number"
                  step="0.01"
                  className="ml-auto h-8 w-20 text-right"
                  value={it.percent}
                  disabled={modo !== 'manual_pct'}
                  onChange={(e) => setLinha(i, { percent: Number(e.target.value) })}
                />
              </td>
              <td className="py-1.5 pl-2 text-right">
                <FormControl
                  type="number"
                  step="0.01"
                  className="ml-auto h-8 w-28 text-right"
                  value={(it.amount_cents / 100).toFixed(2)}
                  disabled={modo !== 'manual_valor'}
                  onChange={(e) => setLinha(i, { amount_cents: Math.round(Number(e.target.value) * 100) })}
                />
              </td>
              <td className="pl-2">
                <button type="button" onClick={() => remLinha(i)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-2 flex items-center justify-between">
        <Button type="button" size="sm" variant="outline" onClick={addLinha} className="h-7 text-xs">
          <Plus className="mr-1 h-3 w-3" /> Adicionar CC
        </Button>
        <div className={cn('text-[11px]', validacao.ok ? 'text-success' : 'text-destructive')}>
          {validacao.ok ? '✓ Rateio fechado' : validacao.error}
        </div>
      </div>
    </div>
  );
}
