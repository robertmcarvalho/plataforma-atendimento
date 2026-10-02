'use client';

import { FormSelect } from '@/components/form/FormSelect';
import { BillingField } from '@/components/billing/BillingPrimitives';
import { CYCLE_STATUS_LABELS } from '@/lib/billing/billingFormat';
import type { BillingCycle } from '@/lib/billing/billingApi';

export function BillingCycleSelect({
  value,
  onChange,
  cycles,
  label = 'Ciclo',
  allowEmpty = false,
  emptyLabel = 'Todos',
  className,
  selectClassName,
}: {
  value: string;
  onChange: (cycleId: string) => void;
  cycles: BillingCycle[];
  label?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
  selectClassName?: string;
}) {
  return (
    <BillingField label={label} className={className}>
      <FormSelect
        className={selectClassName || 'mt-1 w-full min-w-[220px]'}
        size="sm"
        value={value}
        onChange={onChange}
        placeholder="Selecione um ciclo…"
        options={[
          ...(allowEmpty ? [{ value: '', label: emptyLabel }] : []),
          ...cycles.map((c) => ({
            value: c.id,
            label: `${c.label || `${c.apuracao_start} → ${c.apuracao_end}`} (${CYCLE_STATUS_LABELS[c.status] || c.status})`,
          })),
        ]}
      />
    </BillingField>
  );
}
