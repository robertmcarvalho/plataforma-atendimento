'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import { PharmacyAddressFields, type PharmacyAddressValues } from '@/components/cadastro/pharmacy/PharmacyAddressFields';

type ApiState = { code: string; name: string };
type ApiCity = { name: string };

export type DriverAddressValues = PharmacyAddressValues;

type Props = {
  values: DriverAddressValues;
  onChange: (patch: Partial<DriverAddressValues>) => void;
  statesQuery: UseQueryResult<ApiState[]>;
  citiesQuery: UseQueryResult<ApiCity[]>;
  disabled?: boolean;
  onLookupMessage?: (msg: string | null) => void;
};

export function DriverAddressFields(props: Props) {
  return <PharmacyAddressFields {...props} />;
}
