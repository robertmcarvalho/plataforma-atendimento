'use client';

import { useQuery } from '@tanstack/react-query';
import { FormSelect } from '@/components/form/FormSelect';
import { BillingField } from '@/components/billing/BillingPrimitives';
import { fetchCostCenters } from '@/lib/billing/billingApi';

export function BillingCostCenterFilter({
  value,
  onChange,
  label = 'Centro de custo',
  className,
  selectClassName,
}: {
  value: string;
  onChange: (costCenterId: string) => void;
  label?: string;
  className?: string;
  selectClassName?: string;
}) {
  const ccQuery = useQuery({
    queryKey: ['billing', 'cost-centers', 'active'],
    queryFn: () => fetchCostCenters(true),
  });

  return (
    <BillingField label={label} className={className}>
      <FormSelect
        className={selectClassName || 'mt-1 w-full min-w-[180px]'}
        size="sm"
        value={value}
        onChange={onChange}
        options={[
          { value: '', label: 'Todos' },
          ...(ccQuery.data || []).map((cc) => ({ value: cc.id, label: cc.name })),
        ]}
      />
    </BillingField>
  );
}
