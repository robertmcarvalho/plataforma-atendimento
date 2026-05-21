'use client';

import { DollarSign } from 'lucide-react';
import { BrCentsInput } from '@/components/form/BrCentsInput';
import { CadastroField } from '@/components/cadastro/CadastroPrimitives';
import {
  validateCommercialPayoutWarning,
  type PharmacyCommercialForm,
} from '@/lib/pharmacyCommercial';

type Props = {
  value: PharmacyCommercialForm;
  onChange: (next: PharmacyCommercialForm) => void;
  disabled?: boolean;
};

export function PharmacyCommercialTermsFields({ value, onChange, disabled }: Props) {
  const feeWarn = validateCommercialPayoutWarning(
    value.delivery_fee_cents,
    value.delivery_fee_driver_payout_cents,
  );
  const minWarn = validateCommercialPayoutWarning(
    value.minimum_guaranteed_cents,
    value.minimum_guaranteed_driver_payout_cents,
  );

  const patch = (partial: Partial<PharmacyCommercialForm>) => onChange({ ...value, ...partial });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <CadastroField icon={DollarSign} label="Taxa de entrega (cobrada da farmácia)">
          <BrCentsInput
            value={value.delivery_fee_cents}
            onChange={(cents) => patch({ delivery_fee_cents: cents })}
            disabled={disabled}
            className="h-10"
          />
        </CadastroField>
        <CadastroField icon={DollarSign} label="Repasse da taxa ao entregador">
          <BrCentsInput
            value={value.delivery_fee_driver_payout_cents}
            onChange={(cents) => patch({ delivery_fee_driver_payout_cents: cents })}
            disabled={disabled}
            className="h-10"
          />
        </CadastroField>
      </div>
      {feeWarn ? <p className="text-xs text-warning">{feeWarn}</p> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <CadastroField icon={DollarSign} label="Mínimo garantido (opcional)">
          <BrCentsInput
            value={value.minimum_guaranteed_cents}
            onChange={(cents) => patch({ minimum_guaranteed_cents: cents })}
            disabled={disabled}
            className="h-10"
          />
        </CadastroField>
        <CadastroField icon={DollarSign} label="Repasse do mínimo ao entregador">
          <BrCentsInput
            value={value.minimum_guaranteed_driver_payout_cents}
            onChange={(cents) => patch({ minimum_guaranteed_driver_payout_cents: cents })}
            disabled={disabled}
            className="h-10"
          />
        </CadastroField>
      </div>
      {minWarn ? <p className="text-xs text-warning">{minWarn}</p> : null}
    </div>
  );
}
