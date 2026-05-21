export type CatalogProfile = { code: string; label: string; is_active: boolean; sort_order?: number };
export type CatalogSector = {
  sector_key: string;
  display_name: string;
  is_active: boolean;
  sort_order?: number;
  sector_id?: string | null;
  metadata?: Record<string, unknown>;
};
export type CatalogMessage = {
  message_key: string;
  channel: string;
  content: string;
  is_active: boolean;
  metadata?: Record<string, unknown>;
};
export type CatalogSlaRule = {
  demand_key: string;
  profile_code?: string | null;
  settings: Record<string, unknown>;
};
export type CatalogOutOfHours = {
  channel: string;
  is_active: boolean;
  message: string;
  settings?: Record<string, unknown>;
};

export type CatalogSnapshot = {
  profiles: CatalogProfile[];
  sectors: CatalogSector[];
  messages: CatalogMessage[];
  sla_rules: CatalogSlaRule[];
  out_of_hours: CatalogOutOfHours | null;
};

export type SlaSettingsForm = {
  first_response_sla_minutes: number;
  treatment_sla_minutes: number;
  resolution_sla_minutes: number;
  first_response_action: string;
  treatment_action: string;
  resolution_action: string;
  use_business_hours: boolean;
  /** default | plantao | UUID do setor (horário do setor) */
  business_hours_id: string;
  business_hours_label: string;
};

export function slaSettingsFromRecord(raw: Record<string, unknown> | undefined): SlaSettingsForm {
  const r = raw || {};
  return {
    first_response_sla_minutes: Number(r.first_response_sla_minutes) || 25,
    treatment_sla_minutes: Number(r.treatment_sla_minutes) || 120,
    resolution_sla_minutes: Number(r.resolution_sla_minutes) || 480,
    first_response_action: String(r.first_response_action || 'alert_attendant'),
    treatment_action: String(r.treatment_action || 'alert_and_reassign'),
    resolution_action: String(r.resolution_action || 'escalate_supervisor'),
    use_business_hours: r.use_business_hours !== false,
    business_hours_id: String(r.business_hours_id || 'default'),
    business_hours_label: String(r.business_hours_label || 'Padrão agendado'),
  };
}

export function slaSettingsToRecord(form: SlaSettingsForm): Record<string, unknown> {
  return {
    first_response_sla_minutes: form.first_response_sla_minutes,
    treatment_sla_minutes: form.treatment_sla_minutes,
    resolution_sla_minutes: form.resolution_sla_minutes,
    first_response_action: form.first_response_action,
    treatment_action: form.treatment_action,
    resolution_action: form.resolution_action,
    use_business_hours: form.use_business_hours,
    business_hours_id: form.business_hours_id || 'default',
    business_hours_label: form.business_hours_label || 'Padrão agendado',
  };
}
