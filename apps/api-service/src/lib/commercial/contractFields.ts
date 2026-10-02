export const CONTRACT_REQUIRED_FIELD_KEYS = [
  'legal_representative_name',
  'legal_representative_cpf',
  'legal_representative_email',
  'legal_representative_phone',
  'cnpj',
  'address_cep',
  'address_street',
  'address_number',
  'address_neighborhood',
  'city',
  'state',
  'contact_expedition_name',
  'contact_expedition_phone',
  'contact_financial_name',
  'contact_financial_phone',
] as const;

export type ContractFieldKey = (typeof CONTRACT_REQUIRED_FIELD_KEYS)[number];

export type ContractChecklist = {
  total: number;
  filled: number;
  percent: number;
  missing: ContractFieldKey[];
  complete: boolean;
};

function filled(value: unknown): boolean {
  return value != null && String(value).trim().length > 0;
}

export function contractChecklistFromLead(lead: Record<string, unknown>): ContractChecklist {
  const missing: ContractFieldKey[] = [];
  for (const key of CONTRACT_REQUIRED_FIELD_KEYS) {
    if (!filled(lead[key])) missing.push(key);
  }
  const total = CONTRACT_REQUIRED_FIELD_KEYS.length;
  const filledCount = total - missing.length;
  return {
    total,
    filled: filledCount,
    percent: total ? Math.round((filledCount / total) * 100) : 0,
    missing,
    complete: missing.length === 0,
  };
}

export function isContractStageName(name: string | null | undefined): boolean {
  return String(name || '')
    .trim()
    .toLowerCase() === 'contrato';
}
