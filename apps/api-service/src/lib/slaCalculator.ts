import { addBusinessMinutes, normalizeBusinessHours, type BusinessHoursConfig } from './businessHours';

export type SlaSettingsInput = {
  first_response_sla_minutes?: number;
  treatment_sla_minutes?: number;
  resolution_sla_minutes?: number;
  use_business_hours?: boolean;
};

export type SlaDeadlinePreview = {
  at: string;
  first_response_deadline: string;
  treatment_deadline: string;
  resolution_deadline: string;
  use_business_hours: boolean;
};

function toPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export function previewSlaDeadlines(
  settings: SlaSettingsInput,
  businessHours?: BusinessHoursConfig | null,
  from: Date = new Date()
): SlaDeadlinePreview {
  const first = toPositiveInt(settings.first_response_sla_minutes, 30);
  const treatment = Math.max(first, toPositiveInt(settings.treatment_sla_minutes, 120));
  const resolution = Math.max(treatment, toPositiveInt(settings.resolution_sla_minutes, 480));
  const useBh = settings.use_business_hours !== false && Boolean(businessHours);

  const calc = (minutes: number) => {
    if (useBh && businessHours) return addBusinessMinutes(businessHours, from, minutes);
    return new Date(from.getTime() + minutes * 60 * 1000);
  };

  return {
    at: from.toISOString(),
    first_response_deadline: calc(first).toISOString(),
    treatment_deadline: calc(treatment).toISOString(),
    resolution_deadline: calc(resolution).toISOString(),
    use_business_hours: useBh,
  };
}

export function defaultSlaSettings(): SlaSettingsInput {
  return {
    first_response_sla_minutes: 30,
    treatment_sla_minutes: 120,
    resolution_sla_minutes: 480,
    use_business_hours: true,
  };
}
