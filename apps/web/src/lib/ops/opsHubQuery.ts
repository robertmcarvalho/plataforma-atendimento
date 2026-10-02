export type OpsHubQueryParams = {
  period: number;
  referenceDate?: string;
  pharmacyId?: string;
  attendantId?: string;
};

export function buildOpsHubQueryParams(input: OpsHubQueryParams): Record<string, string | number> {
  const params: Record<string, string | number> = { period: input.period };
  if (input.referenceDate) params.reference_date = input.referenceDate;
  if (input.pharmacyId) params.pharmacy_id = input.pharmacyId;
  if (input.attendantId) params.attendant_id = input.attendantId;
  return params;
}
