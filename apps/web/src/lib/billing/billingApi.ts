import api from '@/lib/api';

export type BillingCostCenter = {
  id: string;
  name: string;
  code: string | null;
  cnpj: string | null;
  corporate_entity_type?: 'coop' | 'flux' | null;
  split_coop_pct: number;
  split_flux_pct: number;
  active: boolean;
  pharmacy_id?: string | null;
  billing_pharmacy_id?: string | null;
  cycle_closes_weekday: number;
  cycle_review_weekday: number;
  invoice_issue_weekday: number;
  invoice_due_weekday: number;
  invoice_due_week_offset: number;
  driver_payment_weekday: number;
  driver_payment_week_offset: number;
  driver_payment_release_condition: 'invoice_paid' | 'manager_release' | 'invoice_paid_or_manager_release' | 'none';
  allow_partial_driver_payment: boolean;
  block_c6_without_invoice_payment: boolean;
  invoice_holiday_policy: 'previous_business_day' | 'next_business_day' | 'keep_requires_approval';
  driver_payment_holiday_policy: 'previous_business_day' | 'next_business_day' | 'keep_requires_approval';
  require_manager_release_reason: boolean;
  default_coverage_daily_billing_treatment: 'charge_pharmacy' | 'absorb_operation' | 'pending_audit';
};

export type BillingHoliday = {
  id: string;
  holiday_date: string;
  name: string;
  scope: 'national' | 'state' | 'city' | 'workspace';
  state: string | null;
  city: string | null;
  active: boolean;
};

export type BillingDailyShareGroupPharmacy = {
  id: string;
  group_id: string;
  pharmacy_id: string;
  active: boolean;
  started_at: string | null;
  ended_at: string | null;
  pharmacies?: { id: string; trade_name?: string | null; legal_name?: string | null; cnpj?: string | null } | null;
};

export type BillingDailyShareGroup = {
  id: string;
  name: string;
  billing_cost_center_id: string | null;
  billing_pharmacy_id: string | null;
  daily_pharmacy_amount_cents: number;
  daily_driver_payout_cents: number | null;
  allocation_rule: 'equal';
  active: boolean;
  billing_cost_centers?: { id: string; name: string } | null;
  billing_pharmacy?: { id: string; trade_name?: string | null; legal_name?: string | null; cnpj?: string | null } | null;
  billing_daily_share_group_pharmacies?: BillingDailyShareGroupPharmacy[];
};

export type BillingAuditNotification = {
  id: string;
  billing_cycle_id: string | null;
  pharmacy_id: string | null;
  driver_id: string | null;
  severity: 'info' | 'warning' | 'critical';
  code: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown> | null;
  status: 'open' | 'resolved';
  created_at: string;
  resolved_at?: string | null;
  drivers?: { id: string; name: string } | null;
  pharmacies?: { id: string; trade_name: string | null; legal_name: string | null } | null;
  billing_cycles?: { id: string; label: string | null } | null;
};

export type BillingOffboardingPreview = {
  id: string;
  driver_id: string;
  task_id: string | null;
  status: 'preview' | 'payable_generated' | 'cancelled';
  last_worked_at: string;
  gross_cents: number;
  discount_cents: number;
  net_cents: number;
  payable_id: string | null;
  payload: {
    driver?: { id: string; name: string; cpf: string | null; pix_key: string | null };
    open_cycles?: { id: string; label: string | null; apuracao_start: string; apuracao_end: string; delivery_count: number }[];
    gross_lines?: {
      kind: string;
      label: string;
      amount_cents: number;
      metadata?: {
        settlement_lines?: {
          kind: string;
          description: string | null;
          pharmacy_amount_cents: number;
          driver_amount_cents: number;
        }[];
        quota_discount_reversed_cents?: number;
        net_driver_payout_cents?: number;
      };
    }[];
    discount_lines?: { kind: string; label: string; amount_cents: number }[];
    pending_quota_lines?: {
      kind: string;
      label: string;
      amount_cents: number;
      source_id?: string | null;
      metadata?: { entry_id?: string; due_date?: string };
    }[];
    existing_payables?: { kind: string; label: string; amount_cents: number }[];
    warnings?: string[];
    totals?: {
      gross_cents: number;
      discount_cents: number;
      net_cents: number;
      operational_gross_cents?: number;
      capital_gross_cents?: number;
      operational_discount_cents?: number;
      capital_discount_cents?: number;
    };
  };
  drivers?: { id: string; name: string; cpf: string | null; pix_key: string | null } | null;
  billing_payables?: { id: string; status: string; due_date: string | null } | null;
};

export type BillingExpenseType = {
  id: string;
  name: string;
  kind: 'fixed' | 'variable';
  default_cost_center_id: string | null;
  default_entity: 'coop' | 'flux' | 'both';
  allocation_mode: 'none' | 'per_pharmacy' | 'per_driver' | 'per_delivery' | 'per_provider';
  recurrence: string | null;
  affects_dre: boolean;
  management_group: 'operational' | 'administrative' | 'financial' | 'tax' | 'commercial' | 'patrimonial' | 'outside_dre';
  dre_group: 'revenue' | 'operational_cost' | 'administrative_expense' | 'financial_expense' | 'tax' | 'commercial_expense' | 'outside_dre';
  allocation_policy: 'direct_cost_center' | 'revenue_share' | 'driver_share' | 'delivery_share' | 'manual' | 'none';
  requires_cost_center: boolean;
  active: boolean;
};

export type BillingLegalEntity = {
  id: string;
  entity_type: 'coop' | 'flux';
  legal_name: string;
  trade_name: string;
  cnpj: string | null;
  state_registration: string | null;
  municipal_registration: string | null;
  tax_regime: string | null;
  address_cep: string | null;
  address_street: string | null;
  address_number: string | null;
  address_neighborhood: string | null;
  address_city: string | null;
  address_state: string | null;
  financial_email: string | null;
  commercial_email: string | null;
  phone: string | null;
  bank_code: string | null;
  bank_name: string | null;
  branch_number: string | null;
  account_number: string | null;
  account_digit: string | null;
  account_type: 'checking' | 'savings' | null;
  pix_key: string | null;
  pix_key_type: string | null;
  default_split_coop_pct: number | null;
  default_split_flux_pct: number | null;
  flux_service_margin_pct: number | null;
  invoice_header_notes: string | null;
  invoice_footer_notes: string | null;
};

export type PharmacyBillingForm = {
  billing_cost_center_id: string | null;
  contract_scope: 'flux_only' | 'coop_only' | 'both';
  split_coop_pct: number | null;
  split_flux_pct: number | null;
  mg_enabled: boolean;
  mg_mode: 'per_driver' | 'shared_pool';
  mg_pool_split_rule: 'equal' | 'by_deliveries';
  minimum_deliveries_count: number | null;
  billing_email: string;
  flux_codpes: number | null;
  flux_codloc: number | null;
  daily_billing_enabled: boolean;
  daily_billing_rule: 'per_driver_delivery_day' | 'fixed_per_driver_cycle';
  daily_billing_quantity: number | null;
  daily_billing_pharmacy_amount_cents: number | null;
  daily_billing_driver_payout_cents: number | null;
  driver_day_base_enabled: boolean;
  driver_day_base_cents: number;
};

export const EMPTY_PHARMACY_BILLING: PharmacyBillingForm = {
  billing_cost_center_id: null,
  contract_scope: 'both',
  split_coop_pct: null,
  split_flux_pct: null,
  mg_enabled: true,
  mg_mode: 'per_driver',
  mg_pool_split_rule: 'by_deliveries',
  minimum_deliveries_count: null,
  billing_email: '',
  flux_codpes: null,
  flux_codloc: null,
  daily_billing_enabled: false,
  daily_billing_rule: 'per_driver_delivery_day',
  daily_billing_quantity: null,
  daily_billing_pharmacy_amount_cents: null,
  daily_billing_driver_payout_cents: null,
  driver_day_base_enabled: false,
  driver_day_base_cents: 7000,
};

export async function fetchBillingStatus(): Promise<{ enabled: boolean }> {
  const res = await api.get('/api/billing/status');
  return res.data as { enabled: boolean };
}

export async function fetchCostCenters(activeOnly = false): Promise<BillingCostCenter[]> {
  const res = await api.get('/api/billing/cost-centers', { params: activeOnly ? { active: '1' } : {} });
  return (res.data as { cost_centers: BillingCostCenter[] }).cost_centers;
}

export async function saveCostCenter(
  input: Partial<BillingCostCenter> & Pick<BillingCostCenter, 'name'>
): Promise<BillingCostCenter> {
  if (input.id) {
    const res = await api.patch(`/api/billing/cost-centers/${input.id}`, input);
    return (res.data as { cost_center: BillingCostCenter }).cost_center;
  }
  const res = await api.post('/api/billing/cost-centers', input);
  return (res.data as { cost_center: BillingCostCenter }).cost_center;
}

export async function deleteCostCenter(id: string): Promise<void> {
  await api.delete(`/api/billing/cost-centers/${id}`);
}

export async function fetchDailyShareGroups(activeOnly = false): Promise<BillingDailyShareGroup[]> {
  const res = await api.get('/api/billing/daily-share-groups', { params: activeOnly ? { active: '1' } : {} });
  return (res.data as { groups: BillingDailyShareGroup[] }).groups;
}

export async function saveDailyShareGroup(
  input: Partial<BillingDailyShareGroup> & { name: string; pharmacy_ids: string[] }
): Promise<BillingDailyShareGroup> {
  if (input.id) {
    const res = await api.patch(`/api/billing/daily-share-groups/${input.id}`, input);
    return (res.data as { group: BillingDailyShareGroup }).group;
  }
  const res = await api.post('/api/billing/daily-share-groups', input);
  return (res.data as { group: BillingDailyShareGroup }).group;
}

export async function deleteDailyShareGroup(id: string): Promise<void> {
  await api.delete(`/api/billing/daily-share-groups/${id}`);
}

export async function fetchBillingHolidays(): Promise<BillingHoliday[]> {
  const res = await api.get('/api/billing/holidays');
  return (res.data as { holidays: BillingHoliday[] }).holidays;
}

export async function saveBillingHoliday(input: Pick<BillingHoliday, 'holiday_date' | 'name'> & Partial<BillingHoliday>): Promise<BillingHoliday> {
  const res = await api.post('/api/billing/holidays', input);
  return (res.data as { holiday: BillingHoliday }).holiday;
}

export async function deleteBillingHoliday(id: string): Promise<void> {
  await api.delete(`/api/billing/holidays/${id}`);
}

export async function fetchBillingAuditNotifications(params?: {
  cycle_id?: string;
  status?: 'open' | 'resolved';
}): Promise<BillingAuditNotification[]> {
  const res = await api.get('/api/billing/audit-notifications', { params });
  return (res.data as { notifications: BillingAuditNotification[] }).notifications;
}

export async function resolveBillingAuditNotification(id: string): Promise<BillingAuditNotification> {
  const res = await api.patch(`/api/billing/audit-notifications/${id}/resolve`);
  return (res.data as { notification: BillingAuditNotification }).notification;
}

export async function fetchBillingOffboardingPreviews(params?: {
  status?: 'preview' | 'payable_generated' | 'cancelled';
  driver_id?: string;
}): Promise<BillingOffboardingPreview[]> {
  const res = await api.get('/api/billing/offboarding-previews', { params });
  return (res.data as { previews: BillingOffboardingPreview[] }).previews;
}

export async function fetchBillingOffboardingPreview(id: string): Promise<BillingOffboardingPreview> {
  const res = await api.get(`/api/billing/offboarding-previews/${id}`);
  return (res.data as { preview: BillingOffboardingPreview }).preview;
}

export async function recalculateOffboardingPreview(input: {
  driver_id: string;
  last_worked_at: string;
  task_id?: string | null;
}): Promise<BillingOffboardingPreview> {
  const res = await api.post('/api/billing/offboarding-previews/recalculate', input);
  return (res.data as { preview: BillingOffboardingPreview }).preview;
}

export async function generateOffboardingPayable(id: string, dueDate?: string | null) {
  const res = await api.post(`/api/billing/offboarding-previews/${id}/generate-payable`, {
    ...(dueDate ? { due_date: dueDate } : {}),
  });
  return res.data as { payable_id: string; net_cents: number };
}

export type OffboardingConferenceChecklist = {
  pix_ok: boolean;
  cpf_ok: boolean;
  signature_signed: boolean;
  conference_ok: boolean;
  pending_entries_count: number;
  pending_quota_count: number;
  undecided_quota_count: number;
  open_cycles_count: number;
  can_generate_payable: boolean;
  blockers: string[];
};

export type OffboardingConferenceFinancialEntry = {
  id: string;
  type: string;
  description: string | null;
  total_amount: number;
  status: string;
  start_date: string | null;
  event_date: string | null;
  absence_disposition: string | null;
  proposed_discount_amount: number | null;
  daily_billing_treatment: string | null;
  notes: string | null;
  drivers?: { id: string; name: string } | null;
  pharmacies?: { id: string; trade_name: string | null; legal_name: string | null } | null;
  financial_installments?: {
    id: string;
    installment_number: number;
    amount: number;
    due_date: string;
    status: string;
    paid_at: string | null;
  }[];
};

export type OffboardingPendingQuotaLine = {
  installment_id: string;
  entry_id: string;
  label: string;
  amount_cents: number;
  due_date: string | null;
  installment_number: number | null;
  decision: 'waived' | 'kept' | 'compensated' | null;
};

export type OffboardingConference = {
  preview: BillingOffboardingPreview;
  conference_state: {
    checked_at: string | null;
    checked_by: string | null;
    notes: string | null;
    quota_decisions: Record<string, 'waived' | 'kept' | 'compensated'>;
  };
  checklist: OffboardingConferenceChecklist;
  operational: {
    financial_task: { id: string; title: string; status: string; due_at: string | null } | null;
    signature_task: { id: string; title: string; status: string } | null;
    signature_status: string | null;
    signature_label: string;
    signed_at: string | null;
    settlement_due_at: string | null;
  };
  open_cycles: { id: string; label: string | null; apuracao_start: string; apuracao_end: string; delivery_count: number }[];
  pending_quotas: OffboardingPendingQuotaLine[];
  financial_entries: OffboardingConferenceFinancialEntry[];
  deliveries: Array<{
    id: string;
    delivered_at: string;
    document_number: string | null;
    source: string;
    verified: boolean;
    billing_cycle_id: string;
    pharmacies?: { trade_name: string | null; legal_name: string | null } | null;
    billing_cycles?: { label: string | null } | null;
  }>;
  quota_account: {
    id: string;
    balance_cents: number;
    integralized_cents: number;
    compensated_cents: number;
    refunded_cents: number;
  } | null;
  quota_ledger: Array<{
    id: string;
    entry_type: string;
    amount_cents: number;
    description: string | null;
    created_at: string;
  }>;
  settlements: Array<{
    id: string;
    billing_cycle_id: string;
    pharmacy_id: string;
    status: string;
    net_driver_payout_cents: number;
    applied_mg: boolean;
    pharmacies?: { trade_name: string | null; legal_name: string | null } | null;
    billing_cycles?: { label: string | null; apuracao_start: string; apuracao_end: string } | null;
    lines: Array<{
      id: string;
      kind: string;
      description: string | null;
      pharmacy_amount_cents: number;
      driver_amount_cents: number;
      metadata?: { financial_entry_id?: string };
    }>;
  }>;
  integrations: { flux_api_configured: boolean; mysql_configured: boolean };
  warnings: string[];
};

export async function fetchOffboardingConference(previewId: string): Promise<OffboardingConference> {
  const res = await api.get(`/api/billing/offboarding-previews/${previewId}/conference`);
  return (res.data as { conference: OffboardingConference }).conference;
}

export async function updateOffboardingConference(
  previewId: string,
  input: { checked?: boolean; notes?: string | null }
): Promise<OffboardingConference> {
  const res = await api.patch(`/api/billing/offboarding-previews/${previewId}/conference`, input);
  return (res.data as { conference: OffboardingConference }).conference;
}

export async function syncOffboardingDeliveries(previewId: string, importMysql = false) {
  const res = await api.post(`/api/billing/offboarding-previews/${previewId}/sync-deliveries`, {
    import_mysql: importMysql,
  });
  return res.data as { operator_message: string; conference: OffboardingConference };
}

export async function decideOffboardingPendingQuota(
  previewId: string,
  input: { installment_id: string; decision: 'waived' | 'kept' | 'compensated'; notes?: string | null }
): Promise<OffboardingConference> {
  const res = await api.post(`/api/billing/offboarding-previews/${previewId}/pending-quota-decision`, input);
  return (res.data as { conference: OffboardingConference }).conference;
}

export type BillingQuotaAccount = {
  id: string;
  driver_id: string;
  integralized_cents: number;
  adjusted_cents: number;
  compensated_cents: number;
  refunded_cents: number;
  balance_cents: number;
  last_movement_at: string | null;
  drivers?: { id: string; name: string; cpf: string | null; status?: string | null } | null;
};

export type BillingQuotaEntry = {
  id: string;
  driver_id: string;
  entry_type: 'integralization' | 'reversal' | 'adjustment' | 'compensation' | 'refund';
  amount_cents: number;
  description: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
};

export async function fetchQuotaAccounts(params?: { driver_id?: string }): Promise<BillingQuotaAccount[]> {
  const res = await api.get('/api/billing/quota-accounts', { params });
  return (res.data as { accounts: BillingQuotaAccount[] }).accounts;
}

export async function fetchQuotaAccountEntries(driverId: string): Promise<BillingQuotaEntry[]> {
  const res = await api.get(`/api/billing/quota-accounts/${driverId}/entries`);
  return (res.data as { entries: BillingQuotaEntry[] }).entries;
}

export async function createQuotaAdjustment(
  driverId: string,
  input: { entry_type: 'adjustment' | 'reversal'; amount_cents: number; description?: string | null }
) {
  const res = await api.post(`/api/billing/quota-accounts/${driverId}/adjustments`, input);
  return res.data as { account_id: string; amount_cents: number };
}

export type BillingProviderAccount = {
  id: string;
  provider_id: string;
  balance_cents: number;
  advance_open_cents: number;
  service_credit_cents: number;
  compensated_cents: number;
  paid_cents: number;
  last_movement_at: string | null;
  billing_internal_providers?: { id: string; legal_name: string; default_entity?: 'coop' | 'flux' | null } | null;
};

export type BillingProviderEntry = {
  id: string;
  provider_id: string;
  entry_type: string;
  amount_cents: number;
  description: string | null;
  created_at: string;
  billing_cost_centers?: { id: string; name: string } | null;
};

export async function fetchProviderAccounts(params?: { provider_id?: string }): Promise<BillingProviderAccount[]> {
  const res = await api.get('/api/billing/provider-accounts', { params });
  return (res.data as { accounts: BillingProviderAccount[] }).accounts;
}

export async function fetchProviderAccountEntries(providerId: string): Promise<BillingProviderEntry[]> {
  const res = await api.get(`/api/billing/provider-accounts/${providerId}/entries`);
  return (res.data as { entries: BillingProviderEntry[] }).entries;
}

export async function createProviderAdvance(input: {
  provider_id: string;
  description?: string | null;
  total_cents: number;
  installment_count: number;
  start_date: string;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  cost_center_id?: string | null;
  legal_entity_type: 'coop' | 'flux';
  notes?: string | null;
}) {
  const res = await api.post('/api/billing/provider-advances', input);
  return res.data as { schedule: Record<string, unknown>; installments: Record<string, unknown>[] };
}

export async function fetchExpenseTypes(): Promise<BillingExpenseType[]> {
  const res = await api.get('/api/billing/expense-types');
  return (res.data as { expense_types: BillingExpenseType[] }).expense_types;
}

export async function saveExpenseType(
  input: Partial<BillingExpenseType> & Pick<BillingExpenseType, 'name' | 'kind'>
): Promise<BillingExpenseType> {
  if (input.id) {
    const res = await api.patch(`/api/billing/expense-types/${input.id}`, input);
    return (res.data as { expense_type: BillingExpenseType }).expense_type;
  }
  const res = await api.post('/api/billing/expense-types', input);
  return (res.data as { expense_type: BillingExpenseType }).expense_type;
}

export async function seedDefaultExpenseTypes(): Promise<{ created: number; skipped: number }> {
  const res = await api.post('/api/billing/expense-types/seed-defaults');
  return res.data as { created: number; skipped: number };
}

export async function fetchLegalEntities(): Promise<BillingLegalEntity[]> {
  const res = await api.get('/api/billing/legal-entities');
  return (res.data as { legal_entities: BillingLegalEntity[] }).legal_entities;
}

export async function saveLegalEntity(
  entityType: 'coop' | 'flux',
  body: Partial<BillingLegalEntity>
): Promise<BillingLegalEntity> {
  const res = await api.put(`/api/billing/legal-entities/${entityType}`, body);
  return (res.data as { legal_entity: BillingLegalEntity }).legal_entity;
}

export type BillingNfseEnvironment = 'producao_restrita' | 'producao';
export type BillingNfseRevenueLine = 'delivery' | 'saas_monthly' | 'saas_per_delivery';

export type BillingNfseIssuerConfig = {
  id: string;
  workspace_id: string;
  entity_type: 'coop' | 'flux';
  environment: BillingNfseEnvironment;
  auto_emit_on_approve: boolean;
  municipal_registration: string | null;
  ibge_city_code: string;
  tax_regime: string | null;
  simples_nacional: boolean;
  dps_series: string | null;
  dps_next_number: number | null;
  active: boolean;
};

export type BillingNfseServiceProfile = {
  id: string;
  workspace_id: string;
  issuer_config_id: string;
  revenue_line: BillingNfseRevenueLine;
  ctn: string;
  nbs: string;
  iss_rate_pct: number | null;
  description_template: string;
  active: boolean;
};

export type BillingNfseCertificatePublic = {
  id: string;
  workspace_id: string;
  issuer_config_id: string;
  thumbprint: string | null;
  subject_cn: string | null;
  valid_from: string | null;
  valid_until: string | null;
  active: boolean;
  uploaded_at: string | null;
  has_secret_ref: boolean;
  has_storage_path: boolean;
};

export type BillingNfseWorkspaceConfig = {
  flags: { nfse_enabled: boolean; saas_enabled: boolean };
  issuers: BillingNfseIssuerConfig[];
  profiles: BillingNfseServiceProfile[];
  certificates: BillingNfseCertificatePublic[];
};

export async function fetchNfseConfig(): Promise<BillingNfseWorkspaceConfig> {
  const res = await api.get('/api/billing/nfse/config');
  return res.data as BillingNfseWorkspaceConfig;
}

export async function saveNfseIssuer(
  entityType: 'coop' | 'flux',
  body: Partial<BillingNfseIssuerConfig>
): Promise<BillingNfseIssuerConfig> {
  const res = await api.put(`/api/billing/nfse/issuers/${entityType}`, body);
  return (res.data as { issuer: BillingNfseIssuerConfig }).issuer;
}

export async function saveNfseProfile(
  profileId: string,
  body: Partial<BillingNfseServiceProfile>
): Promise<BillingNfseServiceProfile> {
  const res = await api.patch(`/api/billing/nfse/profiles/${profileId}`, body);
  return (res.data as { profile: BillingNfseServiceProfile }).profile;
}

export async function saveNfseCertificateMetadata(
  entityType: 'coop' | 'flux',
  body: {
    secret_ref?: string | null;
    thumbprint?: string | null;
    subject_cn?: string | null;
    valid_from?: string | null;
    valid_until?: string | null;
    active?: boolean;
  }
): Promise<{ certificate: BillingNfseCertificatePublic; hint?: string }> {
  const res = await api.put(`/api/billing/nfse/issuers/${entityType}/certificate`, body);
  return res.data as { certificate: BillingNfseCertificatePublic; hint?: string };
}

export type BillingCoraEnvironment = 'stage' | 'production';
export type BillingCoraFineMode = 'none' | 'rate' | 'amount';

export type BillingCoraConfig = {
  id: string;
  workspace_id: string;
  entity_type: 'coop' | 'flux';
  environment: BillingCoraEnvironment;
  client_id: string | null;
  client_id_masked: string | null;
  has_client_id: boolean;
  mtls_secret_ref: string | null;
  has_mtls_material: boolean;
  enabled: boolean;
  /** none | rate (%) | amount (centavos) → payment_terms.fine */
  fine_mode: BillingCoraFineMode;
  fine_rate: number | null;
  fine_amount_cents: number | null;
  /** % a.m. (produto) → payment_terms.interest.rate; Cora 0–100 */
  interest_rate: number | null;
  /** true → payment_forms BANK_SLIP+PIX */
  pix_qr_enabled: boolean;
  service_name_template: string;
  service_description_template: string;
};

export type BillingCoraWorkspaceConfig = {
  flags: { cora_enabled: boolean };
  configs: BillingCoraConfig[];
};

export type BillingBankSlipSummary = {
  id: string;
  status: 'pending' | 'open' | 'paid' | 'canceled' | 'error';
  external_id?: string | null;
  digitable_line?: string | null;
  pdf_url?: string | null;
  /** PDF espelhado no storage Aethera. */
  has_pdf_storage?: boolean;
  last_error?: string | null;
  provider?: string;
};

export async function fetchCoraConfig(): Promise<BillingCoraWorkspaceConfig> {
  const res = await api.get('/api/billing/cora/config');
  return res.data as BillingCoraWorkspaceConfig;
}

export async function saveCoraConfig(
  entityType: 'coop' | 'flux',
  body: {
    environment?: BillingCoraEnvironment;
    client_id?: string | null;
    mtls_secret_ref?: string | null;
    enabled?: boolean;
    fine_mode?: BillingCoraFineMode;
    fine_rate?: number | null;
    fine_amount_cents?: number | null;
    interest_rate?: number | null;
    pix_qr_enabled?: boolean;
    service_name_template?: string;
    service_description_template?: string;
  }
): Promise<{ config: BillingCoraConfig; hint?: string }> {
  const res = await api.put(`/api/billing/cora/configs/${entityType}`, body);
  return res.data as { config: BillingCoraConfig; hint?: string };
}

export async function uploadCoraMtlsMaterial(
  entityType: 'coop' | 'flux',
  body: {
    certificate_pem: string;
    private_key_pem: string;
    mtls_secret_ref?: string | null;
  }
): Promise<{ config: BillingCoraConfig; hint?: string }> {
  const res = await api.put(`/api/billing/cora/configs/${entityType}/mtls`, body);
  return res.data as { config: BillingCoraConfig; hint?: string };
}

export async function emitCoraBankSlip(
  invoiceId: string,
  options?: { force_new?: boolean }
): Promise<{ bank_slip: BillingBankSlipSummary & Record<string, unknown>; created: boolean }> {
  const res = await api.post(`/api/billing/invoices/${invoiceId}/cora-bank-slip`, options || {});
  return res.data as { bank_slip: BillingBankSlipSummary & Record<string, unknown>; created: boolean };
}

export async function cancelCoraBankSlip(
  bankSlipId: string
): Promise<{ bank_slip: BillingBankSlipSummary & Record<string, unknown>; canceled: boolean }> {
  const res = await api.post(`/api/billing/cora/bank-slips/${bankSlipId}/cancel`, {});
  return res.data as { bank_slip: BillingBankSlipSummary & Record<string, unknown>; canceled: boolean };
}

export function pharmacyBillingFromApi(row: Record<string, unknown> | null | undefined): PharmacyBillingForm {
  if (!row) return { ...EMPTY_PHARMACY_BILLING };
  return {
    billing_cost_center_id: (row.billing_cost_center_id as string | null) ?? null,
    contract_scope: (row.contract_scope as PharmacyBillingForm['contract_scope']) || 'both',
    split_coop_pct: row.split_coop_pct != null ? Number(row.split_coop_pct) : null,
    split_flux_pct: row.split_flux_pct != null ? Number(row.split_flux_pct) : null,
    mg_enabled: row.mg_enabled !== false,
    mg_mode: (row.mg_mode as PharmacyBillingForm['mg_mode']) || 'per_driver',
    mg_pool_split_rule: (row.mg_pool_split_rule as PharmacyBillingForm['mg_pool_split_rule']) || 'by_deliveries',
    minimum_deliveries_count:
      row.minimum_deliveries_count != null ? Number(row.minimum_deliveries_count) : null,
    billing_email: String(row.billing_email || ''),
    flux_codpes: row.flux_codpes != null ? Number(row.flux_codpes) : null,
    flux_codloc: row.flux_codloc != null ? Number(row.flux_codloc) : null,
    daily_billing_enabled: row.daily_billing_enabled === true,
    daily_billing_rule:
      row.daily_billing_rule === 'fixed_per_driver_cycle' ? 'fixed_per_driver_cycle' : 'per_driver_delivery_day',
    daily_billing_quantity:
      row.daily_billing_quantity != null ? Number(row.daily_billing_quantity) : null,
    daily_billing_pharmacy_amount_cents:
      row.daily_billing_pharmacy_amount_cents != null ? Number(row.daily_billing_pharmacy_amount_cents) : null,
    daily_billing_driver_payout_cents:
      row.daily_billing_driver_payout_cents != null ? Number(row.daily_billing_driver_payout_cents) : null,
    driver_day_base_enabled: row.driver_day_base_enabled === true,
    driver_day_base_cents:
      row.driver_day_base_cents != null ? Number(row.driver_day_base_cents) : 7000,
  };
}

export function pharmacyBillingToApi(form: PharmacyBillingForm): Record<string, unknown> {
  return {
    billing_cost_center_id: form.billing_cost_center_id || null,
    contract_scope: form.contract_scope,
    split_coop_pct: form.split_coop_pct,
    split_flux_pct: form.split_flux_pct,
    mg_enabled: form.mg_enabled,
    mg_mode: form.mg_mode,
    mg_pool_split_rule: form.mg_pool_split_rule,
    minimum_deliveries_count: form.minimum_deliveries_count,
    billing_email: form.billing_email.trim() || null,
    flux_codpes: form.flux_codpes,
    flux_codloc: form.flux_codloc,
    daily_billing_enabled: form.daily_billing_enabled,
    daily_billing_rule: form.daily_billing_rule,
    daily_billing_quantity: form.daily_billing_quantity,
    daily_billing_pharmacy_amount_cents: form.daily_billing_pharmacy_amount_cents,
    daily_billing_driver_payout_cents: form.daily_billing_driver_payout_cents,
    driver_day_base_enabled: form.driver_day_base_enabled,
    driver_day_base_cents: form.driver_day_base_cents,
  };
}

export type BillingCycle = {
  id: string;
  label: string | null;
  apuracao_start: string;
  apuracao_end: string;
  payment_date: string | null;
  status: 'open' | 'closed';
  closed_at: string | null;
};

export type BillingDelivery = {
  id: string;
  pharmacy_id: string;
  driver_id: string;
  delivered_at: string;
  document_number: string | null;
  route_id: string | null;
  source: string;
  external_id: string;
  cancelled: boolean;
  verified: boolean;
  billing_cycle_id: string | null;
  pharmacies?: { id: string; trade_name?: string; legal_name?: string; name?: string } | null;
  drivers?: { id: string; name: string } | null;
};

export type BillingSettlement = {
  id: string;
  billing_cycle_id: string;
  driver_id: string;
  pharmacy_id: string;
  delivery_count: number;
  pharmacy_charge_cents: number;
  driver_payout_cents: number;
  coop_cents: number;
  flux_cents: number;
  discounts_cents: number;
  operational_net_driver_payout_cents?: number;
  financial_deduction_cents?: number;
  net_driver_payout_cents: number;
  applied_mg: boolean;
  status: 'open' | 'in_review' | 'approved' | 'paid';
  drivers?: {
    id: string;
    name: string;
    primary_pharmacy_id?: string | null;
    driver_pharmacy_links?: Array<{ is_active?: boolean | null; pharmacy_id?: string | null }> | null;
  } | null;
  pharmacies?: {
    id: string;
    trade_name?: string;
    legal_name?: string;
    name?: string;
    billing_cost_center_id?: string | null;
    billing_cost_centers?: { id?: string; name?: string } | null;
  } | null;
  billing_cycles?: BillingCycle | null;
  billing_settlement_lines?: BillingSettlementLine[];
};

export type BillingSettlementLine = {
  id: string;
  kind: string;
  description: string | null;
  pharmacy_amount_cents: number;
  driver_amount_cents: number;
  metadata?: Record<string, unknown> | null;
};

export async function fetchBillingCycles(): Promise<BillingCycle[]> {
  const res = await api.get('/api/billing/cycles');
  return (res.data as { cycles: BillingCycle[] }).cycles;
}

export async function fetchSuggestedCycle(referenceDate?: string) {
  const res = await api.get('/api/billing/cycles/suggested', {
    params: referenceDate ? { reference_date: referenceDate } : {},
  });
  return res.data as {
    apuracao_start: string;
    apuracao_end: string;
    payment_date: string;
    label: string;
  };
}

export async function createBillingCycle(input: {
  apuracao_start: string;
  apuracao_end: string;
  payment_date?: string | null;
  label?: string | null;
}): Promise<{ cycle: BillingCycle; deliveries_assigned: number }> {
  const res = await api.post('/api/billing/cycles', input);
  return res.data as { cycle: BillingCycle; deliveries_assigned: number };
}

export async function closeBillingCycle(id: string) {
  const res = await api.post(`/api/billing/cycles/${id}/close`);
  return res.data as { cycle: BillingCycle; settlements_generated: number };
}

export async function recalculateBillingCycle(id: string, options?: { pharmacyId?: string }) {
  const res = await api.post(`/api/billing/cycles/${id}/recalculate`, {
    pharmacy_id: options?.pharmacyId,
  });
  return res.data as { ok: boolean; settlements: number; pharmacy_id?: string | null };
}

export async function fetchBillingDeliveries(params?: {
  cycle_id?: string;
  pharmacy_id?: string;
  driver_id?: string;
  from?: string;
  to?: string;
  limit?: number;
  page?: number;
}): Promise<{
  deliveries: BillingDelivery[];
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  summary?: {
    verified_total: number;
    by_source: Partial<Record<'flux_api' | 'flux_db' | 'manual' | 'csv' | 'external_app', number>>;
  };
}> {
  const res = await api.get('/api/billing/deliveries', { params: { limit: 50, page: 1, ...params } });
  return res.data as {
    deliveries: BillingDelivery[];
    page: number;
    limit: number;
    total: number;
    total_pages: number;
    summary?: {
      verified_total: number;
      by_source: Partial<Record<'flux_api' | 'flux_db' | 'manual' | 'csv' | 'external_app', number>>;
    };
  };
}

export async function createBillingDelivery(input: {
  pharmacy_id: string;
  driver_id: string;
  delivered_at?: string;
  document_number?: string;
  route_id?: string;
  billing_cycle_id?: string | null;
  verified?: boolean;
  source?: 'flux_api' | 'flux_db' | 'manual' | 'csv' | 'external_app';
  /** Number of delivery rows to create (1–500). Default 1. */
  quantity?: number;
}): Promise<{ delivery: BillingDelivery; deliveries: BillingDelivery[]; created: number }> {
  const res = await api.post('/api/billing/deliveries', {
    source: 'manual',
    verified: false,
    ...input,
  });
  const data = res.data as {
    delivery: BillingDelivery;
    deliveries?: BillingDelivery[];
    created?: number;
  };
  const deliveries = data.deliveries?.length ? data.deliveries : data.delivery ? [data.delivery] : [];
  return {
    delivery: data.delivery || deliveries[0],
    deliveries,
    created: data.created ?? deliveries.length,
  };
}

export async function verifyBillingDelivery(id: string): Promise<BillingDelivery> {
  const res = await api.patch(`/api/billing/deliveries/${id}`, { verified: true });
  return (res.data as { delivery: BillingDelivery }).delivery;
}

export async function importBillingDeliveriesCsv(rows: Record<string, string>[]) {
  const res = await api.post('/api/billing/deliveries/import-csv', { rows });
  return res.data as { imported: number; skipped_errors: { index: number; message: string }[] };
}

export type BillingAtivmobImportResult = {
  imported: number;
  operator_message?: string;
  duplicates_collapsed?: number;
  report: {
    period_start: string;
    period_end: string;
    transportadora: string | null;
    requested_by: string | null;
  };
  stats: {
    total_rows: number;
    delivered_rows: number;
    skipped_rows: number;
    skipped_not_delivered?: number;
    skipped_invalid_dispatch?: number;
    skipped_missing_driver?: number;
    unique_cnpjs: number;
    unique_drivers: number;
    status_counts?: Record<string, number>;
    duplicates_collapsed?: number;
    upsert_rows?: number;
  };
  unmapped_count: number;
  unmapped_sample: { type: string; value: string }[];
  unmapped_summary?: { type: string; value: string; count: number }[];
};

export async function importBillingDeliveriesAtivmob(input: {
  file_base64: string;
  billing_cycle_id?: string | null;
}) {
  const res = await api.post('/api/billing/deliveries/import-ativmob', input);
  return res.data as BillingAtivmobImportResult;
}

export async function fetchBillingSettlements(params?: {
  cycle_id?: string;
  status?: string;
}): Promise<BillingSettlement[]> {
  const res = await api.get('/api/billing/settlements', { params });
  return (res.data as { settlements: BillingSettlement[] }).settlements;
}

export async function fetchBillingSettlement(id: string): Promise<BillingSettlement> {
  const res = await api.get(`/api/billing/settlements/${id}`);
  return (res.data as { settlement: BillingSettlement }).settlement;
}

export async function transitionBillingSettlement(
  id: string,
  action: 'submit_review' | 'approve' | 'mark_paid' | 'reopen'
) {
  const res = await api.post(`/api/billing/settlements/${id}/transition`, { action });
  return (res.data as { settlement: BillingSettlement }).settlement;
}

export async function addPharmacyManualDiscount(
  cycleId: string,
  pharmacyId: string,
  input: {
    amount_cents: number;
    justification: string;
  }
): Promise<BillingSettlement[]> {
  const res = await api.post(
    `/api/billing/cycles/${cycleId}/pharmacies/${pharmacyId}/manual-discounts`,
    input
  );
  return (res.data as { settlements: BillingSettlement[] }).settlements;
}

export async function submitAllSettlements(cycleId: string) {
  const res = await api.post(`/api/billing/cycles/${cycleId}/settlements/submit-all`);
  return res.data as { updated: number };
}

export async function approveAllSettlements(cycleId: string) {
  const res = await api.post(`/api/billing/cycles/${cycleId}/settlements/approve-all`);
  return res.data as {
    updated: number;
    invoices_generated?: number;
    payables_generated?: number;
    pix_batch?: PixBatchExportPayload | null;
  };
}

export async function approvePharmacySettlements(cycleId: string, pharmacyId: string) {
  const res = await api.post(
    `/api/billing/cycles/${cycleId}/pharmacies/${pharmacyId}/settlements/approve`
  );
  return res.data as {
    updated: number;
    side_effects: {
      invoices_generated: number;
      payables_generated: number;
      financial_coop_effects: { quota_integralizations: number; financial_recoveries: number };
      settlements_recalculated?: number;
      warnings: string[];
      pix_batch: PixBatchExportPayload | null;
    };
  };
}

export async function reopenPharmacySettlements(cycleId: string, pharmacyId: string) {
  const res = await api.post(
    `/api/billing/cycles/${cycleId}/pharmacies/${pharmacyId}/settlements/reopen`
  );
  return res.data as {
    updated: number;
    invoices_removed: number;
    payables_resynced: number;
    ledger_entries_removed: number;
    settlements_recalculated?: number;
    recalc_warning?: string;
  };
}

export type BillingSettlementExclusion = {
  id?: string;
  driverId: string;
  pharmacyId: string;
  scope: 'driver' | 'line';
  lineKind: string | null;
  lineFingerprint: string | null;
  justification: string;
  pharmacyAmountCentsBefore: number;
  driverAmountCentsBefore: number;
};

export async function fetchPharmacySettlementExclusions(cycleId: string, pharmacyId: string) {
  const res = await api.get(
    `/api/billing/cycles/${cycleId}/pharmacies/${pharmacyId}/settlement-exclusions`
  );
  return (res.data as { exclusions: BillingSettlementExclusion[] }).exclusions;
}

export async function addPharmacySettlementExclusion(
  cycleId: string,
  pharmacyId: string,
  input: {
    driver_id: string;
    scope: 'driver' | 'line';
    justification: string;
    line_kind?: string;
    line_fingerprint?: string;
    line_id?: string;
    settlement_id?: string;
    pharmacy_amount_cents_before?: number;
    driver_amount_cents_before?: number;
  }
) {
  const res = await api.post(
    `/api/billing/cycles/${cycleId}/pharmacies/${pharmacyId}/settlement-exclusions`,
    input
  );
  return res.data as { id: string; settlements_recalculated: number };
}

export type BillingDayBaseDay = {
  id: string;
  driverId: string;
  pharmacyId: string;
  eventDate: string;
  amountCents: number;
};

export async function fetchPharmacyDayBaseDays(cycleId: string, pharmacyId: string) {
  const res = await api.get(`/api/billing/cycles/${cycleId}/pharmacies/${pharmacyId}/day-base-days`);
  return (res.data as { days: BillingDayBaseDay[] }).days;
}

export async function upsertPharmacyDayBaseDay(
  cycleId: string,
  pharmacyId: string,
  input: { driver_id: string; event_date: string; amount_cents: number; active?: boolean }
) {
  const res = await api.post(`/api/billing/cycles/${cycleId}/pharmacies/${pharmacyId}/day-base-days`, input);
  return res.data as { id: string; settlements_recalculated: number };
}

export type BillingMgOverlay = {
  id: string;
  driverId: string;
  pharmacyId: string;
  multiplier: 0.5 | 1 | 2;
  justification: string;
};

export async function fetchPharmacyMgOverlays(cycleId: string, pharmacyId: string) {
  const res = await api.get(`/api/billing/cycles/${cycleId}/pharmacies/${pharmacyId}/mg-overlays`);
  return (res.data as { overlays: BillingMgOverlay[] }).overlays;
}

export async function upsertPharmacyMgOverlay(
  cycleId: string,
  pharmacyId: string,
  input: { driver_id: string; multiplier: 0.5 | 1 | 2; justification: string }
) {
  const res = await api.post(`/api/billing/cycles/${cycleId}/pharmacies/${pharmacyId}/mg-overlays`, input);
  return res.data as { id: string; settlements_recalculated: number };
}

export type PixBatchExportPayload = {
  template: string;
  file_format: 'csv' | 'xlsx';
  row_count: number;
  total_cents: number;
  skipped_no_pix: number;
  csv?: string;
  xlsx_base64?: string;
  filename: string;
  payment_date?: string | null;
  batches?: PixBatchExportPayload[];
};

export type BillingInvoice = {
  id: string;
  billing_cycle_id: string;
  pharmacy_id: string;
  entity_type: 'coop' | 'flux';
  status: 'draft' | 'approved' | 'sent' | 'paid';
  total_cents: number;
  amount_paid_cents: number;
  public_token: string;
  due_date: string | null;
  pharmacies?: {
    id: string;
    trade_name?: string | null;
    legal_name?: string | null;
    billing_cost_center_id?: string | null;
    billing_cost_centers?: { id?: string; name?: string } | null;
  } | null;
  billing_cycles?: BillingCycle | null;
  nfse?: {
    id: string;
    status: 'pending' | 'authorized' | 'rejected' | 'canceled';
    last_error?: string | null;
    access_key?: string | null;
    dps_number?: string | null;
    entity_type?: 'coop' | 'flux';
    attempt_number?: number;
    has_xml?: boolean;
    has_pdf?: boolean;
  } | null;
  bank_slip?: BillingBankSlipSummary | null;
};

export type BillingInvoiceLine = {
  id: string;
  line_order: number;
  description: string;
  quantity: number;
  unit_cents: number;
  amount_cents: number;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
};

export type BillingInvoiceDetail = BillingInvoice & {
  billing_invoice_lines?: BillingInvoiceLine[];
};

export async function fetchBillingInvoiceDetail(id: string): Promise<BillingInvoiceDetail> {
  const res = await api.get(`/api/billing/invoices/${id}`);
  return (res.data as { invoice: BillingInvoiceDetail }).invoice;
}

export async function addInvoiceInterest(
  id: string,
  input: { amount_cents: number; reason: string; source_movement_id?: string | null }
) {
  const res = await api.post(`/api/billing/invoices/${id}/interest`, input);
  return res.data as { invoice: BillingInvoiceDetail; line: BillingInvoiceLine };
}

export async function fetchBillingInvoices(params?: { cycle_id?: string; status?: string }): Promise<BillingInvoice[]> {
  const res = await api.get('/api/billing/invoices', { params });
  return (res.data as { invoices: BillingInvoice[] }).invoices;
}

export async function generateBillingInvoices(cycleId: string) {
  const res = await api.post('/api/billing/invoices/generate', { cycle_id: cycleId });
  return res.data as { ok: boolean; invoices: number };
}

export type ApproveBillingInvoiceResult = {
  invoice: BillingInvoice;
  nfse_enabled?: boolean;
  nfse?: {
    document: {
      id: string;
      status: string;
      last_error?: string | null;
      access_key?: string | null;
      dps_number?: string | null;
      entity_type?: string;
    };
    authorized?: boolean;
    emitted?: boolean;
    error?: string | null;
  } | null;
};

export async function approveBillingInvoice(id: string): Promise<ApproveBillingInvoiceResult> {
  const res = await api.post(`/api/billing/invoices/${id}/approve`);
  return res.data as ApproveBillingInvoiceResult;
}

function filenameFromDisposition(disposition: string | undefined, fallback: string): string {
  const match = disposition?.match(/filename="?([^"]+)"?/i);
  return match?.[1] || fallback;
}

async function downloadNfseBlob(path: string, fallbackName: string): Promise<void> {
  const res = await api.get(path, { responseType: 'blob' });
  const blob = res.data as Blob;
  const filename = filenameFromDisposition(
    res.headers['content-disposition'] as string | undefined,
    fallbackName
  );
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectUrl);
}

export async function downloadBillingNfseXml(documentId: string): Promise<void> {
  await downloadNfseBlob(`/api/billing/nfse/documents/${documentId}/xml`, 'nfse.xml');
}

export async function downloadBillingNfsePdf(documentId: string): Promise<void> {
  await downloadNfseBlob(`/api/billing/nfse/documents/${documentId}/pdf`, 'danfse.pdf');
}

/** Download PDF do boleto espelhado no storage Aethera (backfill sob demanda). */
export async function downloadBillingBankSlipPdf(bankSlipId: string): Promise<void> {
  await downloadNfseBlob(`/api/billing/cora/bank-slips/${bankSlipId}/pdf`, 'boleto.pdf');
}

export type InvoiceDocumentArtifactsPackage = {
  invoice_id: string;
  pharmacy_email: string | null;
  billing_email: string | null;
  email: string | null;
  package_ready: boolean;
  missing: string[];
  artifacts: Array<{
    kind: string;
    status: string;
    ready: boolean;
    url?: string | null;
    note?: string | null;
  }>;
};

export async function fetchInvoiceDocumentArtifacts(
  invoiceId: string
): Promise<InvoiceDocumentArtifactsPackage> {
  const res = await api.get(`/api/billing/invoices/${invoiceId}/artifacts`);
  return res.data as InvoiceDocumentArtifactsPackage;
}

export type SendInvoicePackageEmailResult = {
  ok: boolean;
  dry_run: boolean;
  to: string;
  subject: string;
  invoice_id: string;
  attachments: Array<{ kind: string; filename: string; bytes: number }>;
  invoice_html_url: string | null;
  note?: string;
  missing?: string[];
};

/** Envia pacote da fatura (boleto + DANFSe + XML + link HTML). Use dry_run para não chamar SMTP. */
export async function sendBillingInvoicePackageEmail(
  invoiceId: string,
  opts?: { dry_run?: boolean; to?: string }
): Promise<SendInvoicePackageEmailResult> {
  const res = await api.post(`/api/billing/invoices/${invoiceId}/send-email`, opts || {});
  return res.data as SendInvoicePackageEmailResult;
}

export type ReemitBillingNfseResult = {
  previous_document_id: string;
  document: {
    id: string;
    status: string;
    last_error?: string | null;
    access_key?: string | null;
    dps_number?: string | null;
    entity_type?: string;
    attempt_number?: number;
    has_xml?: boolean;
    has_pdf?: boolean;
  };
  authorized: boolean;
  emitted: boolean;
  error?: string | null;
};

export async function reemitBillingNfseDocument(documentId: string): Promise<ReemitBillingNfseResult> {
  const res = await api.post(`/api/billing/nfse/documents/${documentId}/reemit`);
  return res.data as ReemitBillingNfseResult;
}

export type CancelBillingNfseResult = {
  document: {
    id: string;
    status: string;
    last_error?: string | null;
    access_key?: string | null;
    protocol?: string | null;
    dps_number?: string | null;
    entity_type?: string;
    attempt_number?: number;
    has_xml?: boolean;
    has_pdf?: boolean;
  };
  canceled: boolean;
  protocol?: string | null;
  error?: string | null;
};

export async function cancelBillingNfseDocument(
  documentId: string,
  body: { justificativa: string; codigo_motivo?: 1 | 2 | 3 | '1' | '2' | '3'; n_ped_reg?: number }
): Promise<CancelBillingNfseResult> {
  const res = await api.post(`/api/billing/nfse/documents/${documentId}/cancel`, body);
  return res.data as CancelBillingNfseResult;
}

export async function registerInvoicePayment(id: string, amountCents: number) {
  const res = await api.post(`/api/billing/invoices/${id}/payment`, { amount_cents: amountCents });
  return (res.data as { invoice: BillingInvoice }).invoice;
}

export async function fetchPublicBillingReport(token: string) {
  const res = await api.get(`/api/public/billing/reports/${token}`);
  return res.data;
}

export type BillingPayable = {
  id: string;
  beneficiary_type: 'driver' | 'supplier' | 'operational' | 'internal_provider' | 'shareholder' | 'commercial_partner' | 'leader';
  beneficiary_id: string | null;
  legal_entity_type: 'coop' | 'flux' | null;
  cost_center_id: string | null;
  billing_cycle_id: string | null;
  description: string;
  amount_cents: number;
  amount_paid_cents: number;
  status: 'draft' | 'approved' | 'paid' | 'cancelled';
  due_date: string | null;
  scheduled_payment_date?: string | null;
  payment_method?: 'pix' | 'transfer' | 'cash' | 'other' | null;
  payment_bank_account_id?: string | null;
  pix_key?: string | null;
  pix_key_type?: string | null;
  batch_eligible?: boolean;
  payment_batch_status?: 'pending' | 'exported' | 'paid' | 'cancelled' | null;
  payment_batch_export_id?: string | null;
  payment_batch_exported_at?: string | null;
  original_due_date?: string | null;
  effective_due_date?: string | null;
  payment_blocked?: boolean;
  block_reason?: string | null;
  manager_released_at?: string | null;
  manager_released_by?: string | null;
  manager_release_reason?: string | null;
  category?: string | null;
  competence_month?: string | null;
  origin_type?: string | null;
  origin_id?: string | null;
  gross_amount_cents?: number | null;
  compensated_amount_cents?: number | null;
  net_amount_cents?: number | null;
  pending_payment_cents?: number;
  management_group?: string | null;
  dre_group?: string | null;
  allocation_policy?: string | null;
  metadata?: Record<string, unknown> | null;
  beneficiary_name?: string;
  billing_cost_centers?: { id: string; name: string; corporate_entity_type?: 'coop' | 'flux' | null } | null;
  billing_cycles?: { id: string; label: string | null; apuracao_start: string; apuracao_end: string } | null;
};

export type BillingSupplier = {
  id: string;
  name: string;
  cpf_cnpj: string | null;
  pix_key: string | null;
  pix_key_type: string | null;
  category: string | null;
  active: boolean;
};

export type BillingExpense = {
  id?: string;
  expense_type_id: string | null;
  description: string;
  amount_cents: number;
  expense_date: string;
  cost_center_id: string | null;
  legal_entity_type: 'coop' | 'flux' | 'both';
  allocation: Record<string, number>;
  recurrence: string | null;
  status: 'draft' | 'approved' | 'paid';
  management_group?: string | null;
  dre_group?: string | null;
  allocation_policy?: string | null;
  billing_expense_types?: {
    id: string;
    name: string;
    kind: string;
    management_group?: string | null;
    dre_group?: string | null;
    allocation_policy?: string | null;
    requires_cost_center?: boolean | null;
  } | null;
  billing_cost_centers?: { id: string; name: string; corporate_entity_type?: 'coop' | 'flux' | null } | null;
};

export async function fetchBillingPayables(params?: {
  cycle_id?: string;
  beneficiary_type?: string;
  status?: string;
  cost_center_id?: string;
}): Promise<BillingPayable[]> {
  const res = await api.get('/api/billing/payables', { params });
  return (res.data as { payables: BillingPayable[] }).payables;
}

export async function createBillingPayable(input: {
  beneficiary_type: 'driver' | 'supplier' | 'operational';
  beneficiary_id?: string | null;
  legal_entity_type?: 'coop' | 'flux' | null;
  cost_center_id?: string | null;
  description: string;
  amount_cents: number;
  due_date?: string | null;
}) {
  const res = await api.post('/api/billing/payables', input);
  return (res.data as { payable: BillingPayable }).payable;
}

export async function approveBillingPayable(id: string) {
  const res = await api.post(`/api/billing/payables/${id}/approve`);
  return (res.data as { payable: BillingPayable }).payable;
}

export async function releaseBillingPayable(id: string, reason: string) {
  const res = await api.post(`/api/billing/payables/${id}/release`, { reason });
  return (res.data as { payable: BillingPayable }).payable;
}

export async function payBillingPayable(
  id: string,
  input: {
    amount_cents: number;
    payment_method?: string;
    legal_entity_id?: string | null;
    bank_account_id?: string | null;
    card_last_four?: string | null;
    card_brand?: string | null;
  }
) {
  const res = await api.post(`/api/billing/payables/${id}/payment`, input);
  return (res.data as { payable: BillingPayable }).payable;
}

export type DriverPayslipRecentWeek = {
  label: string;
  amount_cents: number;
  is_current: boolean;
};

export type DriverPayslipPharmacy = {
  id: string;
  name: string;
  mg_mode: string | null;
  earnings: {
    kind: 'minimum_guarantee' | 'deliveries' | 'other';
    description: string;
    amount_cents: number;
    delivery_count: number | null;
    active_days: number | null;
    total_days: number | null;
  } | null;
  absences: { description: string; amount_cents: number }[];
  dailies: {
    description: string;
    amount_cents: number;
    event_date: string | null;
    /** `thursday_settlement` sai no PIX de quinta; `financial_daily` sai no PIX de terça. */
    pay_track: 'thursday_settlement' | 'financial_daily';
  }[];
  subtotal_cents: number;
};

export type DriverPayslip = {
  payable_id: string;
  track: 'weekly' | 'daily';
  driver: { id: string; name: string; cpf_masked: string; phone: string | null; pix_key: string | null; pix_key_type: string | null };
  cycle: { id: string; label: string | null; apuracao_start: string; apuracao_end: string };
  pix: { payment_date: string | null; amount_cents: number; method: string };
  totals: {
    cycle_total_cents: number;
    /** Diárias da trilha Diárias (PIX terça), fora de `thursday_pix_cents`. */
    dailies_cents: number;
    dailies_paid_cents: number;
    /** Diária-base de escala, já dentro de `thursday_pix_cents`. */
    weekly_dailies_cents: number;
    thursday_pix_cents: number;
    absences_cents: number;
    discounts_cents: number;
    earnings_cents: number;
  };
  cost_centers: {
    id: string | null;
    name: string;
    apuracao_start: string;
    apuracao_end: string;
    boleto_due_date: string | null;
    driver_payment_date: string | null;
    invoice_due_week_offset: number;
    driver_payment_week_offset: number;
    schedule_note: string;
    pharmacies: DriverPayslipPharmacy[];
  }[];
  discounts: { kind: string; label: string; description: string; amount_cents: number }[];
  dailies: {
    description: string;
    amount_cents: number;
    payment_date: string | null;
    pharmacy_name: string | null;
    paid: boolean;
  }[];
  recent_weeks: DriverPayslipRecentWeek[];
  send: {
    can_send: boolean;
    phone: string | null;
    last_sent_at: string | null;
    expires_at: string | null;
    public_url: string | null;
    revoked: boolean;
  };
  support_phone: string | null;
};

export type PayslipSendResult = {
  payslip: DriverPayslip;
  token: string;
  public_url: string;
  expires_at: string;
  whatsapp_sent: boolean;
  whatsapp_skipped_reason: string | null;
};

export async function fetchDriverPayslip(payableId: string): Promise<DriverPayslip> {
  const res = await api.get(`/api/billing/payables/${payableId}/payslip`);
  return (res.data as { payslip: DriverPayslip }).payslip;
}

export async function sendDriverPayslip(payableId: string): Promise<PayslipSendResult> {
  const res = await api.post(`/api/billing/payables/${payableId}/payslip/send`);
  return res.data as PayslipSendResult;
}

export async function fetchDriverPayslipPdf(payableId: string): Promise<Blob> {
  const res = await api.get(`/api/billing/payables/${payableId}/payslip/pdf`, { responseType: 'blob' });
  return res.data as Blob;
}

export async function revokeDriverPayslip(payableId: string): Promise<void> {
  await api.post(`/api/billing/payables/${payableId}/payslip/revoke`);
}

export async function fetchBillingSuppliers(): Promise<BillingSupplier[]> {
  const res = await api.get('/api/billing/suppliers');
  return (res.data as { suppliers: BillingSupplier[] }).suppliers;
}

export async function saveBillingSupplier(input: Partial<BillingSupplier> & { name: string }) {
  if (input.id) {
    const res = await api.patch(`/api/billing/suppliers/${input.id}`, input);
    return (res.data as { supplier: BillingSupplier }).supplier;
  }
  const res = await api.post('/api/billing/suppliers', input);
  return (res.data as { supplier: BillingSupplier }).supplier;
}

export async function fetchBillingExpenses(): Promise<BillingExpense[]> {
  const res = await api.get('/api/billing/expenses');
  return (res.data as { expenses: BillingExpense[] }).expenses;
}

export async function saveBillingExpense(
  input: Partial<BillingExpense> & { description: string; amount_cents: number; expense_date: string }
) {
  if (input.id) {
    const res = await api.patch(`/api/billing/expenses/${input.id}`, input);
    return (res.data as { expense: BillingExpense }).expense;
  }
  const res = await api.post('/api/billing/expenses', input);
  return (res.data as { expense: BillingExpense }).expense;
}

export async function fetchPixBatchPreview(cycleId: string) {
  const res = await api.get('/api/billing/reports/pix-batch/preview', { params: { cycle_id: cycleId } });
  return res.data as {
    rows: {
      name: string;
      cpf: string | null;
      pix_key: string | null;
      amount_cents: number;
      payment_date: string | null;
      original_payment_date: string | null;
      payment_adjustment_reason: string | null;
      warnings: string[];
    }[];
    batches: {
      payment_date: string;
      original_payment_dates: string[];
      adjustment_reasons: string[];
      rows: {
        name: string;
        cpf: string | null;
        pix_key: string | null;
        amount_cents: number;
        payment_date: string | null;
        original_payment_date: string | null;
        payment_adjustment_reason: string | null;
        warnings: string[];
      }[];
      total_cents: number;
      blocked_count: number;
    }[];
    total_cents: number;
    cycle_label: string | null;
  };
}

export async function exportPixBatch(cycleId: string, bankAccountId?: string) {
  const res = await api.post('/api/billing/reports/pix-batch/export', {
    cycle_id: cycleId,
    ...(bankAccountId ? { bank_account_id: bankAccountId } : {}),
  });
  return res.data as PixBatchExportPayload;
}

export type PayablesBatchPreviewParams = {
  payment_date?: string;
  legal_entity_type?: 'coop' | 'flux' | '';
  bank_account_id?: string;
  beneficiary_type?: string;
  cost_center_id?: string;
  payable_ids?: string[];
  /** Inclui APs de diárias (financial_daily). Default omitido = excluídos. */
  include_financial_daily?: boolean;
};

export type PayablesBatchPreviewRow = {
  payable_id?: string;
  beneficiary_type?: string;
  name: string;
  cpf: string | null;
  pix_key: string | null;
  amount_cents: number;
  payment_date: string | null;
  original_payment_date: string | null;
  payment_adjustment_reason: string | null;
  warnings: string[];
};

export type PayablesBatchPreview = {
  rows: PayablesBatchPreviewRow[];
  batches: {
    payment_date: string;
    original_payment_dates: string[];
    adjustment_reasons: string[];
    rows: PayablesBatchPreviewRow[];
    total_cents: number;
    blocked_count: number;
  }[];
  total_cents: number;
  cycle_label: string | null;
};

export async function fetchPayablesBatchPreview(params: PayablesBatchPreviewParams = {}) {
  const res = await api.get('/api/billing/reports/payables-batch/preview', {
    params: {
      ...params,
      legal_entity_type: params.legal_entity_type || undefined,
      payable_ids: params.payable_ids?.length ? params.payable_ids.join(',') : undefined,
    },
  });
  return res.data as PayablesBatchPreview;
}

export async function exportPayablesBatch(params: PayablesBatchPreviewParams = {}) {
  const res = await api.post('/api/billing/reports/payables-batch/export', {
    ...params,
    legal_entity_type: params.legal_entity_type || undefined,
  });
  return res.data as PixBatchExportPayload;
}

export type DailyPixPreview = {
  payment_date: string;
  rows: Array<{
    driver_id: string;
    name: string;
    cpf: string | null;
    pix_key: string | null;
    amount_cents: number;
    payment_date: string | null;
    reference?: string;
    warnings: string[];
  }>;
  total_cents: number;
  pending_count: number;
  skipped_no_pix: number;
  pending_approval_count: number;
};

export async function fetchDailyPixPreview(paymentDate: string) {
  const res = await api.get('/api/billing/reports/pix-dailies/preview', {
    params: { payment_date: paymentDate },
  });
  return res.data as DailyPixPreview;
}

export async function exportDailyPixBatch(input: {
  payment_date: string;
  bank_account_id?: string;
  sync_payables?: boolean;
}) {
  const res = await api.post('/api/billing/reports/pix-dailies/export', input);
  return res.data as PixBatchExportPayload;
}

export async function syncDailyPixPayables(paymentDate: string) {
  const res = await api.post('/api/billing/reports/pix-dailies/sync-payables', { payment_date: paymentDate });
  return res.data as { created: number; existing: number; payables: string[] };
}

export function downloadPixBatchExport(payload: PixBatchExportPayload) {
  if (payload.batches?.length) {
    for (const batch of payload.batches) {
      downloadPixBatchExport(batch);
    }
    return;
  }

  if (payload.file_format === 'xlsx' && payload.xlsx_base64) {
    const bytes = Uint8Array.from(atob(payload.xlsx_base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = payload.filename || `pix-lote.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  if (payload.csv) {
    const blob = new Blob([payload.csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = payload.filename || `pix-lote.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export async function generateRecurringExpenses(month: string) {
  const res = await api.post('/api/billing/expenses/generate-recurring', { month });
  return res.data as { created: number };
}

export type InssReportRow = {
  driver_id: string;
  name: string;
  cpf: string | null;
  gross_remuneration_cents: number;
};

export type InsuranceReportRow = {
  driver_id: string;
  name: string;
  cpf: string | null;
  birth_date: string | null;
  phone: string | null;
  contract_started_at: string | null;
  leader_name: string | null;
  pharmacies: string;
  inactive_at?: string | null;
  termination_reason?: string | null;
};

export async function fetchInssAccountingReport(month: string) {
  const res = await api.get('/api/billing/reports/inss-accounting', { params: { month } });
  return res.data as {
    rows: InssReportRow[];
    total_cents: number;
    month: string;
    sent_at: string | null;
  };
}

export async function downloadInssAccountingCsv(month: string) {
  const res = await api.get('/api/billing/reports/inss-accounting/csv', { params: { month }, responseType: 'text' });
  return res.data as string;
}

export async function fetchInsuranceActiveReport(month: string, cutoffDate?: string) {
  const res = await api.get('/api/billing/reports/insurance-active', {
    params: { month, cutoff_date: cutoffDate },
  });
  return res.data as { rows: InsuranceReportRow[]; cutoff_date: string; month: string };
}

export async function downloadInsuranceActiveCsv(month: string, cutoffDate?: string) {
  const res = await api.get('/api/billing/reports/insurance-active/csv', {
    params: { month, cutoff_date: cutoffDate },
    responseType: 'text',
  });
  return res.data as string;
}

export async function fetchInsuranceTerminatedReport(month: string) {
  const res = await api.get('/api/billing/reports/insurance-terminated', { params: { month } });
  return res.data as { rows: InsuranceReportRow[]; month: string };
}

export type BillingCycleHealthRow = {
  cycle_id: string;
  label: string | null;
  apuracao_start: string;
  apuracao_end: string;
  status: 'open' | 'closed';
  closed_at: string | null;
  competence_month: string;
  settlements: number;
  approved_settlements: number;
  invoices: number;
  paid_invoices: number;
  payables: number;
  paid_payables: number;
  pix_batches: number;
  dre_closed: boolean;
};

export async function fetchBillingCycleHealth(limit = 6): Promise<BillingCycleHealthRow[]> {
  const res = await api.get('/api/billing/reports/cycle-health', { params: { limit } });
  return (res.data as { rows: BillingCycleHealthRow[] }).rows;
}

export async function downloadInsuranceTerminatedCsv(month: string) {
  const res = await api.get('/api/billing/reports/insurance-terminated/csv', {
    params: { month },
    responseType: 'text',
  });
  return res.data as string;
}

export async function markBillingReportSent(
  kind: 'inss-accounting' | 'insurance-active' | 'insurance-terminated',
  body: { month: string; row_count: number; total_cents?: number | null; cutoff_date?: string | null }
) {
  const res = await api.post(`/api/billing/reports/${kind}/mark-sent`, body);
  return res.data;
}

export type FluxIntegrationStatus = {
  flux_api_configured: boolean;
  flux_api_skipped: boolean;
  mysql_configured: boolean;
  external_app_enabled: boolean;
};

export async function fetchFluxIntegrationStatus(): Promise<FluxIntegrationStatus> {
  const res = await api.get('/api/billing/integrations/flux/status');
  return res.data as FluxIntegrationStatus;
}

export async function syncFluxPharmacies(body: { dry_run?: boolean; force?: boolean }) {
  const res = await api.post('/api/billing/integrations/flux/sync-pharmacies', body);
  return res.data as { result: Record<string, unknown>; operator_message?: string };
}

export async function syncFluxDeliveries(body: {
  data_inicio: string;
  data_fim: string;
  dry_run?: boolean;
}) {
  const res = await api.post('/api/billing/integrations/flux/sync-deliveries', body);
  return res.data as { result: Record<string, unknown>; operator_message?: string };
}

export async function reconcileFluxMysql(body: {
  data_inicio: string;
  data_fim: string;
  import_missing?: boolean;
}) {
  const res = await api.post('/api/billing/integrations/flux/reconcile-mysql', body);
  return res.data as {
    report: Record<string, unknown>;
    imported: number;
    import_stats?: {
      imported: number;
      skipped_unmapped_pharmacy: number;
      skipped_unmapped_driver: number;
      skipped_duplicate: number;
    };
    assigned_to_cycle?: number;
    operator_message?: string;
  };
}

export type BillingInternalProvider = {
  id?: string;
  legal_name: string;
  trade_name?: string | null;
  cpf_cnpj?: string | null;
  contract_type?: string;
  role_title?: string | null;
  email?: string | null;
  phone?: string | null;
  phone_secondary?: string | null;
  financial_email?: string | null;
  address_cep?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  address_neighborhood?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  pix_key?: string | null;
  pix_key_type?: string | null;
  bank_code?: string | null;
  bank_name?: string | null;
  branch_number?: string | null;
  account_number?: string | null;
  account_digit?: string | null;
  account_type?: 'checking' | 'savings' | null;
  default_entity: 'coop' | 'flux';
  default_cost_center_id?: string | null;
  contract_started_at?: string | null;
  inactive_at?: string | null;
  termination_reason?: string | null;
  default_monthly_cents?: number | null;
  active: boolean;
  notes?: string | null;
};

export type BillingShareholder = {
  id?: string;
  entity_type: 'coop' | 'flux';
  legal_name: string;
  trade_name?: string | null;
  cpf_cnpj?: string | null;
  email?: string | null;
  phone?: string | null;
  financial_email?: string | null;
  address_cep?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  address_neighborhood?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  pix_key?: string | null;
  pix_key_type?: string | null;
  bank_code?: string | null;
  bank_name?: string | null;
  branch_number?: string | null;
  account_number?: string | null;
  account_digit?: string | null;
  account_type?: 'checking' | 'savings' | null;
  ownership_pct?: number | null;
  pro_labore_default_cents: number;
  is_administrator: boolean;
  contract_started_at?: string | null;
  inactive_at?: string | null;
  termination_reason?: string | null;
  active: boolean;
  notes?: string | null;
};

export async function fetchInternalProviders(activeOnly = false): Promise<BillingInternalProvider[]> {
  const res = await api.get('/api/billing/internal-providers', { params: activeOnly ? { active: '1' } : {} });
  return (res.data as { internal_providers: BillingInternalProvider[] }).internal_providers;
}

export async function fetchInternalProvider(id: string): Promise<BillingInternalProvider> {
  const res = await api.get(`/api/billing/internal-providers/${id}`);
  return (res.data as { internal_provider: BillingInternalProvider }).internal_provider;
}

export async function saveInternalProvider(input: BillingInternalProvider): Promise<BillingInternalProvider> {
  if (input.id) {
    const res = await api.patch(`/api/billing/internal-providers/${input.id}`, input);
    return (res.data as { internal_provider: BillingInternalProvider }).internal_provider;
  }
  const res = await api.post('/api/billing/internal-providers', input);
  return (res.data as { internal_provider: BillingInternalProvider }).internal_provider;
}

export async function fetchShareholders(params?: { active?: boolean; entity_type?: string }): Promise<BillingShareholder[]> {
  const res = await api.get('/api/billing/shareholders', {
    params: {
      ...(params?.active ? { active: '1' } : {}),
      ...(params?.entity_type ? { entity_type: params.entity_type } : {}),
    },
  });
  return (res.data as { shareholders: BillingShareholder[] }).shareholders;
}

export async function fetchShareholder(id: string): Promise<BillingShareholder> {
  const res = await api.get(`/api/billing/shareholders/${id}`);
  return (res.data as { shareholder: BillingShareholder }).shareholder;
}

export async function saveShareholder(input: BillingShareholder): Promise<BillingShareholder> {
  if (input.id) {
    const res = await api.patch(`/api/billing/shareholders/${input.id}`, input);
    return (res.data as { shareholder: BillingShareholder }).shareholder;
  }
  const res = await api.post('/api/billing/shareholders', input);
  return (res.data as { shareholder: BillingShareholder }).shareholder;
}

export async function generateCompanyPayroll(month: string) {
  const res = await api.post('/api/billing/company-payroll/generate', { month });
  return res.data as { shareholders: number; providers: number };
}

export async function fetchShareholderProLaboreInss(month: string) {
  const res = await api.get('/api/billing/reports/shareholder-pro-labore-inss', { params: { month } });
  return res.data as {
    rows: { shareholder_id: string; legal_name: string; cpf_cnpj: string | null; entity_type: string; pro_labore_cents: number }[];
    total_cents: number;
    month: string;
  };
}

export async function downloadShareholderProLaboreInssCsv(month: string) {
  const res = await api.get('/api/billing/reports/shareholder-pro-labore-inss/csv', {
    params: { month },
    responseType: 'text',
  });
  return res.data as string;
}

export type BillingCommercialPartner = {
  id?: string;
  legal_name: string;
  trade_name?: string | null;
  cpf_cnpj?: string | null;
  partner_kind: 'sales_agent' | 'referrer' | 'both';
  email?: string | null;
  phone?: string | null;
  financial_email?: string | null;
  address_cep?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  address_neighborhood?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  pix_key?: string | null;
  pix_key_type?: string | null;
  bank_code?: string | null;
  bank_name?: string | null;
  branch_number?: string | null;
  account_number?: string | null;
  account_digit?: string | null;
  account_type?: 'checking' | 'savings' | null;
  default_entity: 'coop' | 'flux';
  contract_started_at?: string | null;
  inactive_at?: string | null;
  active: boolean;
  notes?: string | null;
};

export type BillingCommissionRule = {
  id?: string;
  role_type: 'sales_agent' | 'referrer';
  calculation_basis: 'percent_deal_value' | 'fixed_per_conversion';
  percent_value?: number | null;
  fixed_cents?: number | null;
  active: boolean;
  effective_from?: string | null;
  effective_until?: string | null;
  notes?: string | null;
};

export type BillingCommissionReportRow = {
  accrual_id: string;
  partner_id: string;
  partner_name: string;
  commission_role: 'sales_agent' | 'referrer';
  commercial_lead_id: string;
  lead_trade_name: string;
  pharmacy_id: string | null;
  competence_month: string;
  amount_cents: number;
  deal_value_cents: number | null;
  status: string;
  payable_id: string | null;
  converted_at: string | null;
};

export async function fetchCommercialPartners(
  activeOnly = false,
  partnerKind?: 'sales_agent' | 'referrer' | 'both'
): Promise<BillingCommercialPartner[]> {
  const res = await api.get('/api/billing/commercial-partners', {
    params: {
      ...(activeOnly ? { active: '1' } : {}),
      ...(partnerKind ? { partner_kind: partnerKind } : {}),
    },
  });
  return (res.data as { commercial_partners: BillingCommercialPartner[] }).commercial_partners;
}

export async function fetchCommercialPartner(id: string): Promise<BillingCommercialPartner> {
  const res = await api.get(`/api/billing/commercial-partners/${id}`);
  return (res.data as { commercial_partner: BillingCommercialPartner }).commercial_partner;
}

export async function saveCommercialPartner(input: BillingCommercialPartner): Promise<BillingCommercialPartner> {
  if (input.id) {
    const res = await api.patch(`/api/billing/commercial-partners/${input.id}`, input);
    return (res.data as { commercial_partner: BillingCommercialPartner }).commercial_partner;
  }
  const res = await api.post('/api/billing/commercial-partners', input);
  return (res.data as { commercial_partner: BillingCommercialPartner }).commercial_partner;
}

export async function fetchCommissionRules(partnerId: string): Promise<BillingCommissionRule[]> {
  const res = await api.get(`/api/billing/commercial-partners/${partnerId}/commission-rules`);
  return (res.data as { commission_rules: BillingCommissionRule[] }).commission_rules;
}

export async function saveCommissionRule(
  partnerId: string,
  roleType: 'sales_agent' | 'referrer',
  rule: BillingCommissionRule
): Promise<BillingCommissionRule> {
  const res = await api.put(`/api/billing/commercial-partners/${partnerId}/commission-rules/${roleType}`, rule);
  return (res.data as { commission_rule: BillingCommissionRule }).commission_rule;
}

export async function accrueCommissions(month: string) {
  const res = await api.post('/api/billing/commissions/accrue', { month });
  return res.data as { created: number; skipped: number };
}

export async function generateCommissionPayables(month: string) {
  const res = await api.post('/api/billing/commissions/generate-payables', { month });
  return res.data as { payables: number; accruals_linked: number };
}

export async function fetchCommissionsReport(month: string) {
  const res = await api.get('/api/billing/reports/commissions', { params: { month } });
  return res.data as {
    rows: BillingCommissionReportRow[];
    total_cents: number;
    month: string;
  };
}

export async function downloadCommissionsCsv(month: string) {
  const res = await api.get('/api/billing/reports/commissions/csv', {
    params: { month },
    responseType: 'text',
  });
  return res.data as string;
}

export type LeaderCommissionRule = {
  id?: string;
  leader_id?: string;
  percent_of_flux_margin: number;
  active: boolean;
  notes?: string | null;
};

export type LeaderCommissionItem = {
  leader: { id: string; name: string; status: string; city?: string | null; state?: string | null };
  rule: LeaderCommissionRule | null;
};

export type LeaderCommissionReportRow = {
  accrual_id: string;
  leader_id: string;
  leader_name: string;
  pharmacy_id: string;
  pharmacy_name: string;
  competence_month: string;
  flux_billing_cents: number;
  flux_margin_cents: number;
  margin_pct_applied: number;
  commission_pct_applied: number;
  amount_cents: number;
  status: string;
  payable_id: string | null;
};

export async function fetchLeaderCommissionItems(): Promise<LeaderCommissionItem[]> {
  const res = await api.get('/api/billing/leader-commission/rules');
  return (res.data as { items: LeaderCommissionItem[] }).items;
}

export async function saveLeaderCommissionRule(leaderId: string, rule: LeaderCommissionRule) {
  const res = await api.put(`/api/billing/leader-commission/rules/${leaderId}`, rule);
  return (res.data as { rule: LeaderCommissionRule }).rule;
}

export async function accrueLeaderCommissions(month: string) {
  const res = await api.post('/api/billing/leader-commissions/accrue', { month });
  return res.data as { created: number; skipped: number };
}

export async function generateLeaderCommissionPayables(month: string) {
  const res = await api.post('/api/billing/leader-commissions/generate-payables', { month });
  return res.data as { payables: number; accruals_linked: number };
}

export async function fetchLeaderCommissionsReport(month: string) {
  const res = await api.get('/api/billing/reports/leader-commissions', { params: { month } });
  return res.data as { rows: LeaderCommissionReportRow[]; total_cents: number; month: string };
}

export async function downloadLeaderCommissionsCsv(month: string) {
  const res = await api.get('/api/billing/reports/leader-commissions/csv', {
    params: { month },
    responseType: 'text',
  });
  return res.data as string;
}

export type BillingBankAccount = {
  id?: string;
  legal_entity_id: string;
  name: string;
  bank_code?: string | null;
  bank_name?: string | null;
  branch_number?: string | null;
  account_number?: string | null;
  account_digit?: string | null;
  account_type?: 'checking' | 'savings' | null;
  pix_key?: string | null;
  pix_key_type?: string | null;
  is_default: boolean;
  active: boolean;
  pix_export_template: 'generic' | 'itau' | 'bradesco' | 'santander' | 'bb' | 'inter' | 'nubank' | 'c6';
  notes?: string | null;
  legal_entity?: { entity_type: string; legal_name?: string; trade_name?: string };
};

export type BillingBankMovement = {
  id: string;
  bank_account_id: string;
  movement_date: string;
  amount_cents: number;
  direction: 'credit' | 'debit';
  description: string | null;
  reconciled: boolean;
  billing_payment_id: string | null;
  reconciled_at?: string | null;
  reconciled_by?: string | null;
};

export type BillingPaymentRow = {
  id: string;
  amount_cents: number;
  paid_at: string;
  payment_method: string;
  payable_id: string | null;
  invoice_id?: string | null;
  legal_entity_id: string | null;
  bank_account_id: string | null;
  reconciled?: boolean;
  reconciled_at?: string | null;
  notes?: string | null;
  created_by?: string | null;
  reconciled_by?: string | null;
  created_by_user?: { id: string; name: string } | null;
  reconciled_by_user?: { id: string; name: string } | null;
  billing_invoices?: {
    id: string;
    due_date: string | null;
    total_cents: number;
    pharmacies?: { id: string; trade_name?: string | null; legal_name?: string | null } | null;
  } | null;
  billing_payables?: {
    id: string;
    description?: string | null;
    due_date?: string | null;
    beneficiary_name?: string | null;
    beneficiary_type?: BillingPayable['beneficiary_type'] | null;
    beneficiary_id?: string | null;
    legal_entity_type?: 'coop' | 'flux' | null;
    category?: string | null;
    origin_type?: string | null;
  } | null;
};

export async function fetchTreasurySummary(bankAccountId?: string) {
  const res = await api.get('/api/billing/treasury/summary', {
    params: bankAccountId ? { bank_account_id: bankAccountId } : {},
  });
  return res.data as { unreconciled_movements: number; unreconciled_payments: number };
}

export async function fetchBankAccounts(params?: { legal_entity_id?: string; active?: boolean }) {
  const res = await api.get('/api/billing/bank-accounts', {
    params: {
      ...(params?.legal_entity_id ? { legal_entity_id: params.legal_entity_id } : {}),
      ...(params?.active ? { active: '1' } : {}),
    },
  });
  return (res.data as { bank_accounts: BillingBankAccount[] }).bank_accounts;
}

export async function saveBankAccount(input: BillingBankAccount) {
  const { id, legal_entity: _legalEntity, ...payload } = input;
  if (id) {
    const res = await api.patch(`/api/billing/bank-accounts/${id}`, payload);
    return (res.data as { bank_account: BillingBankAccount }).bank_account;
  }
  const res = await api.post('/api/billing/bank-accounts', payload);
  return (res.data as { bank_account: BillingBankAccount }).bank_account;
}

export async function fetchBankMovements(params?: { bank_account_id?: string; reconciled?: boolean }) {
  const res = await api.get('/api/billing/bank-movements', {
    params: {
      ...(params?.bank_account_id ? { bank_account_id: params.bank_account_id } : {}),
      ...(params?.reconciled === false ? { reconciled: '0' } : {}),
      ...(params?.reconciled === true ? { reconciled: '1' } : {}),
    },
  });
  return (res.data as { movements: BillingBankMovement[] }).movements;
}

export async function fetchUnreconciledPayments() {
  const res = await api.get('/api/billing/payments/unreconciled');
  return (res.data as { payments: BillingPaymentRow[] }).payments;
}

export async function fetchBillingPayments(params?: { bank_account_id?: string; reconciled?: boolean }) {
  const res = await api.get('/api/billing/payments', {
    params: {
      ...(params?.bank_account_id ? { bank_account_id: params.bank_account_id } : {}),
      ...(params?.reconciled === false ? { reconciled: '0' } : {}),
      ...(params?.reconciled === true ? { reconciled: '1' } : {}),
    },
  });
  return (res.data as { payments: BillingPaymentRow[] }).payments;
}

export type BillingBankStatementFormat = 'csv' | 'ofx' | 'cora' | 'c6';

/** Client-side hint used when the operator picks a file (API also auto-detects on import). */
export function detectBillingBankStatementFormat(content: string): BillingBankStatementFormat {
  const stripped = content.replace(/^\uFEFF/, '');
  if (/<OFX>/i.test(stripped) || /<STMTTRN>/i.test(stripped)) return 'ofx';
  const sample = stripped.slice(0, 8000);
  const normalized = sample
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (normalized.includes('data lancamento') && (normalized.includes('entrada') || normalized.includes('saida'))) {
    return 'c6';
  }
  // Extrato de lote C6 (pagamentos PIX em massa)
  if (
    normalized.includes('data pagamento') &&
    normalized.includes('valor') &&
    (normalized.includes('tipo e beneficiario') ||
      normalized.includes('beneficiario') ||
      normalized.includes('extrato do lote'))
  ) {
    return 'c6';
  }
  if (normalized.includes('tipo transacao') && (normalized.includes('identificacao') || normalized.includes('transacao'))) {
    return 'cora';
  }
  return 'csv';
}

export async function importBankMovements(bankAccountId: string, format: BillingBankStatementFormat, content: string) {
  const res = await api.post('/api/billing/bank-movements/import', {
    bank_account_id: bankAccountId,
    format,
    content,
  });
  return res.data as {
    imported: number;
    skipped: number;
    parsed: number;
    auto_reconciled: number;
    review_required: number;
    unmatched: number;
    payment_without_movement: number;
    auto_reconcile_pending?: number;
    batch_id: string;
    format?: BillingBankStatementFormat;
    format_requested?: BillingBankStatementFormat;
    parse_stats?: { total: number; by_date: Record<string, number> };
  };
}

export async function reconcileBankMovement(movementId: string, paymentId: string) {
  const res = await api.post(`/api/billing/bank-movements/${movementId}/reconcile`, { payment_id: paymentId });
  return res.data as { ok: boolean };
}

export async function manualSettleBankMovement(
  movementId: string,
  input: { target_type: 'invoice' | 'payable'; target_id: string; notes?: string | null }
) {
  const res = await api.post(`/api/billing/bank-movements/${movementId}/manual-settlement`, input);
  return res.data as { ok: boolean; payment_id: string; warning?: string | null };
}

export async function settleInvoiceWithInterest(
  movementId: string,
  input: { invoice_id: string; reason: string; notes?: string | null }
) {
  const res = await api.post(`/api/billing/bank-movements/${movementId}/settle-with-interest`, input);
  return res.data as {
    ok: boolean;
    warning?: string | null;
    result?: { interest_cents?: number; pending_payments_removed?: number };
  };
}

export const BILLING_DRE_CUTOVER_MONTH = '2026-07';

export type BillingDrePharmacyRow = {
  pharmacy_id: string;
  pharmacy_name: string;
  cost_center_id: string | null;
  cost_center_name: string | null;
  revenue_cents: number;
  variable_cost_cents: number;
  fixed_cost_cents: number;
  tax_cents: number;
  operational_cost_cents?: number;
  administrative_expense_cents?: number;
  commercial_expense_cents?: number;
  financial_expense_cents?: number;
  result_cents: number;
};

export type BillingDreCostCenterRow = {
  cost_center_id: string;
  cost_center_name: string;
  pharmacy_count: number;
  revenue_cents: number;
  variable_cost_cents: number;
  fixed_cost_cents: number;
  tax_cents: number;
  operational_cost_cents?: number;
  administrative_expense_cents?: number;
  commercial_expense_cents?: number;
  financial_expense_cents?: number;
  result_cents: number;
};

export type BillingDreTaxRule = {
  id: string;
  entity_type: 'coop' | 'flux';
  tax_code: string;
  name: string;
  rate_pct: number;
  effective_from: string | null;
  effective_until: string | null;
  active: boolean;
};

export type BillingDreReport = {
  entity_type: 'coop' | 'flux';
  competence_month: string;
  cutover_month: string;
  before_cutover: boolean;
  period_status: 'open' | 'closed';
  revenue_cents: number;
  variable_cost_cents: number;
  fixed_cost_cents: number;
  tax_cents: number;
  operational_cost_cents: number;
  administrative_expense_cents: number;
  commercial_expense_cents: number;
  financial_expense_cents: number;
  management_summary: {
    operational_cost_cents: number;
    administrative_expense_cents: number;
    commercial_expense_cents: number;
    financial_expense_cents: number;
    tax_cents: number;
    result_operational_cents: number;
    result_net_cents: number;
  };
  result_cents: number;
  consolidated: {
    account_id: string;
    account_code: string;
    account_name: string;
    line_kind: string;
    display_order: number;
    amount_cents: number;
  }[];
  pharmacies: BillingDrePharmacyRow[];
  cost_centers: BillingDreCostCenterRow[];
  warnings: string[];
};

export async function fetchDreConfig() {
  const res = await api.get('/api/billing/dre/config');
  return res.data as { cutover_month: string };
}

export async function fetchDreReport(entity: 'coop' | 'flux', month: string, costCenterId?: string | null) {
  const res = await api.get(`/api/billing/dre/${entity}`, { params: { month, cost_center_id: costCenterId || undefined } });
  return (res.data as { report: BillingDreReport }).report;
}

export async function recalculateDre(entity: 'coop' | 'flux', month: string) {
  const res = await api.post(`/api/billing/dre/${entity}/recalculate`, { month });
  return (res.data as { report: BillingDreReport }).report;
}

export async function closeDrePeriod(entity: 'coop' | 'flux', month: string) {
  const res = await api.post(`/api/billing/dre/${entity}/close`, { month });
  return (res.data as { report: BillingDreReport }).report;
}

export async function reopenDrePeriod(entity: 'coop' | 'flux', month: string) {
  const res = await api.post(`/api/billing/dre/${entity}/reopen`, { month });
  return (res.data as { report: BillingDreReport }).report;
}

export async function fetchDreTaxRules() {
  const res = await api.get('/api/billing/dre/tax-rules');
  return (res.data as { tax_rules: BillingDreTaxRule[] }).tax_rules;
}

export async function saveDreTaxRule(
  id: string,
  input: Partial<Pick<BillingDreTaxRule, 'rate_pct' | 'name' | 'active' | 'effective_from' | 'effective_until'>>
) {
  const res = await api.patch(`/api/billing/dre/tax-rules/${id}`, input);
  return (res.data as { tax_rule: BillingDreTaxRule }).tax_rule;
}

export async function downloadDreCsv(entity: 'coop' | 'flux', month: string, costCenterId?: string | null): Promise<string> {
  const res = await api.get(`/api/billing/dre/${entity}/export`, {
    params: { month, cost_center_id: costCenterId || undefined },
    responseType: 'text',
  });
  return res.data as string;
}

export type BillingCapitalCooperativoLine = {
  id: string;
  driver_id: string;
  driver_name: string | null;
  movement_date: string;
  source: 'quota_account' | 'financial_ledger';
  entry_type: string;
  amount_cents: number;
  description: string | null;
  billing_cycle_id: string | null;
  settlement_id: string | null;
  offboarding_preview_id: string | null;
};

export type BillingCapitalCooperativoReport = {
  month: string;
  summary: {
    integralization_cents: number;
    compensation_cents: number;
    refund_cents: number;
    adjustment_cents: number;
    advance_recovery_cents: number;
    uniform_recovery_cents: number;
    bag_recovery_cents: number;
    digital_cert_recovery_cents: number;
    other_financial_recovery_cents: number;
    net_movement_cents: number;
  };
  by_driver: Array<{
    driver_id: string;
    driver_name: string | null;
    integralization_cents: number;
    compensation_cents: number;
    refund_cents: number;
    financial_recovery_cents: number;
    net_movement_cents: number;
    quota_balance_cents: number;
  }>;
  lines: BillingCapitalCooperativoLine[];
};

export async function fetchCapitalCooperativoReport(month: string, driverId?: string | null) {
  const res = await api.get('/api/billing/capital-cooperativo/report', {
    params: { month, driver_id: driverId || undefined },
  });
  return (res.data as { report: BillingCapitalCooperativoReport }).report;
}
