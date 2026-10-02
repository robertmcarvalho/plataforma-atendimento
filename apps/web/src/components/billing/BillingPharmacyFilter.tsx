'use client';

import { CadastroSearchCombobox } from '@/components/cadastro/CadastroSearchCombobox';
import { BillingField } from '@/components/billing/BillingPrimitives';

export function BillingPharmacyFilter({
  value,
  onChange,
  label = 'Farmácia',
  className,
  disabled,
}: {
  value: string;
  onChange: (pharmacyId: string) => void;
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <BillingField label={label} className={className}>
      <CadastroSearchCombobox
        entity="pharmacy"
        value={value}
        onChange={onChange}
        minChars={2}
        inputSize="sm"
        disabled={disabled}
        className="mt-1"
      />
    </BillingField>
  );
}
