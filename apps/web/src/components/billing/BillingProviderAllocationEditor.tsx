'use client';

import { useMemo } from 'react';
import { Calculator } from 'lucide-react';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { BillingEmptyState } from '@/components/billing/BillingPrimitives';
import { cn } from '@/lib/utils';
import type { BillingInternalProvider } from '@/lib/billing/billingApi';

export type ProviderAllocationLine = {
  provider_id: string;
  amount_cents: number;
};

type Props = {
  totalCents: number;
  providers: BillingInternalProvider[];
  value: ProviderAllocationLine[];
  onChange: (lines: ProviderAllocationLine[]) => void;
};

export function BillingProviderAllocationEditor({ totalCents, providers, value, onChange }: Props) {
  const sum = useMemo(() => value.reduce((s, l) => s + l.amount_cents, 0), [value]);
  const ok = sum === totalCents || !value.length;

  const setLine = (i: number, amount_cents: number) => {
    onChange(value.map((l, idx) => (idx === i ? { ...l, amount_cents } : l)));
  };

  const addLine = () => {
    const p = providers.find((pr) => !value.some((v) => v.provider_id === pr.id));
    if (!p?.id) return;
    onChange([...value, { provider_id: p.id, amount_cents: 0 }]);
  };

  if (!providers.length) {
    return <BillingEmptyState className="py-4">Cadastre prestadores internos para ratear benefícios.</BillingEmptyState>;
  }

  return (
    <div className="rounded-xl border border-border bg-background/40 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
        <Calculator className="h-3.5 w-3.5" /> Rateio por prestador (convênio / combustível)
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase text-subtle-foreground">
            <th className="py-1 text-left">Prestador</th>
            <th className="py-1 text-right">Valor (R$)</th>
          </tr>
        </thead>
        <tbody>
          {value.map((line, i) => (
            <tr key={line.provider_id} className="border-t border-border/60">
              <td className="py-1.5 pr-2">
                <FormSelect
                  className="w-full"
                  size="sm"
                  value={line.provider_id}
                  onChange={(next) => onChange(value.map((l, idx) => (idx === i ? { ...l, provider_id: next } : l)))}
                  options={providers.map((p) => ({ value: p.id!, label: p.legal_name }))}
                />
              </td>
              <td className="py-1.5 pl-2 text-right">
                <FormControl
                  type="number"
                  step="0.01"
                  className="ml-auto h-8 w-28 text-right"
                  value={(line.amount_cents / 100).toFixed(2)}
                  onChange={(e) => setLine(i, Math.round(Number(e.target.value) * 100))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center justify-between">
        <button type="button" className="text-xs text-primary hover:underline" onClick={addLine}>
          + Adicionar prestador
        </button>
        <span className={cn('text-[11px]', ok ? 'text-success' : 'text-destructive')}>
          {ok ? '✓ Rateio fechado' : `Soma ${(sum / 100).toFixed(2)} ≠ ${(totalCents / 100).toFixed(2)}`}
        </span>
      </div>
    </div>
  );
}

export function providerAllocationToRecord(lines: ProviderAllocationLine[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) {
    if (l.provider_id && l.amount_cents > 0) out[l.provider_id] = l.amount_cents;
  }
  return out;
}
