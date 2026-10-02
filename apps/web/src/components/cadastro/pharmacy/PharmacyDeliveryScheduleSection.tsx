'use client';

import { PharmacyDeliveryScheduleEditor } from '@/components/cadastro/pharmacy/PharmacyDeliveryScheduleEditor';

type Props = {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  disabled?: boolean;
};

export function PharmacyDeliveryScheduleSection({ value, onChange, disabled }: Props) {
  return <PharmacyDeliveryScheduleEditor value={value} onChange={onChange} disabled={disabled} />;
}
