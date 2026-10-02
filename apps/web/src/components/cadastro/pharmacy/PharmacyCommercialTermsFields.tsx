'use client';

import { DollarSign, Truck } from 'lucide-react';
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

/** Layout Revive `FarmaciaCadastro` — Condições comerciais. */
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
        <CadastroField icon={DollarSign} label="Taxa de entrega" required>
          <BrCentsInput
            value={value.delivery_fee_cents}
            onChange={(cents) => patch({ delivery_fee_cents: cents })}
            disabled={disabled}
          />
        </CadastroField>
        <CadastroField icon={Truck} label="Taxa de entrega repassada ao entregador" required>
          <BrCentsInput
            value={value.delivery_fee_driver_payout_cents}
            onChange={(cents) => patch({ delivery_fee_driver_payout_cents: cents })}
            disabled={disabled}
          />
        </CadastroField>
        <CadastroField icon={DollarSign} label="Mínimo garantido">
          <BrCentsInput
            value={value.minimum_guaranteed_cents}
            onChange={(cents) => patch({ minimum_guaranteed_cents: cents })}
            disabled={disabled}
          />
        </CadastroField>
        <CadastroField icon={Truck} label="Mínimo garantido repassado ao entregador">
          <BrCentsInput
            value={value.minimum_guaranteed_driver_payout_cents}
            onChange={(cents) => patch({ minimum_guaranteed_driver_payout_cents: cents })}
            disabled={disabled}
          />
        </CadastroField>
      </div>
      {feeWarn ? <p className="text-xs text-warning">{feeWarn}</p> : null}
      {minWarn ? <p className="text-xs text-warning">{minWarn}</p> : null}
      <div className="rounded-md border border-dashed border-border bg-background/40 p-3 text-[11px] text-muted-foreground">
        Valores em reais (BRL). O repasse ao entregador não pode exceder o valor cobrado da farmácia.
      </div>
    </div>
  );
}
