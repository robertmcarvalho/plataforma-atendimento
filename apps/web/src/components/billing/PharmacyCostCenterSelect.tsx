'use client';

import { FormSelect } from '@/components/form/FormSelect';
import { CadastroField } from '@/components/cadastro/CadastroPrimitives';
import { useBillingCostCenters } from '@/lib/billing/useBillingQueries';

type Props = {
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
};

export function PharmacyCostCenterSelect({ value, onChange, disabled }: Props) {
  const { data, isLoading } = useBillingCostCenters(true);

  return (
    <CadastroField label="Centro de custo (faturamento)">
      <FormSelect
        disabled={disabled || isLoading}
        value={value || ''}
        onChange={(v) => onChange(v || null)}
        placeholder={isLoading ? 'Carregando…' : 'Selecione um centro de custo'}
        options={[
          { value: '', label: 'Nenhum' },
          ...(data || []).map((c) => ({
            value: c.id,
            label: c.code ? `${c.name} (${c.code})` : c.name,
          })),
        ]}
      />
    </CadastroField>
  );
}
