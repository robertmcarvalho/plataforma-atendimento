import { normalizeDeliveryScheduleInput, parseCommercialTermsInput, validateCommercialTerms } from '../pharmacyCommercial';
import { deliveryScheduleFromLeadCustomFields } from './leadDeliverySchedule';

export type ContractOnboardingStatus = 'awaiting_lead' | 'lead_submitted' | 'complete';

export type ContractOnboardingSeller = {
  legal_name?: string;
  trade_name?: string;
  delivery_fee_cents?: number | null;
  delivery_fee_driver_payout_cents?: number | null;
  minimum_guaranteed_cents?: number | null;
  minimum_guaranteed_driver_payout_cents?: number | null;
  setup_cents?: number | null;
  setup_parcelado?: boolean;
  setup_parcelas?: number | null;
  drivers_count?: number | null;
  delivery_schedule?: Record<string, unknown>;
  pickup_address_cep?: string;
  pickup_address_street?: string;
  pickup_address_number?: string;
  pickup_address_neighborhood?: string;
  pickup_address_complement?: string;
  pickup_city?: string;
  pickup_state?: string;
};

export type ContractOnboarding = {
  status: ContractOnboardingStatus;
  lead_submitted_at?: string | null;
  seller_completed_at?: string | null;
  data_request_id?: string | null;
  lead_snapshot?: Record<string, unknown> | null;
  seller?: ContractOnboardingSeller;
};

export type SellerContractChecklist = {
  total: number;
  filled: number;
  percent: number;
  missing: string[];
  complete: boolean;
};

function filled(value: unknown): boolean {
  return value != null && String(value).trim().length > 0;
}

function centsFilled(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function parseContractOnboarding(raw: unknown): ContractOnboarding {
  if (!raw || typeof raw !== 'object') return { status: 'awaiting_lead' };
  const o = raw as Record<string, unknown>;
  const status = o.status as ContractOnboardingStatus;
  const validStatus =
    status === 'lead_submitted' || status === 'complete' || status === 'awaiting_lead' ? status : 'awaiting_lead';
  return {
    status: validStatus,
    lead_submitted_at: (o.lead_submitted_at as string) || null,
    seller_completed_at: (o.seller_completed_at as string) || null,
    data_request_id: (o.data_request_id as string) || null,
    lead_snapshot: (o.lead_snapshot as Record<string, unknown>) || null,
    seller: (o.seller as ContractOnboardingSeller) || undefined,
  };
}

export function mergeContractOnboarding(
  current: unknown,
  patch: Partial<ContractOnboarding>,
): ContractOnboarding {
  const base = parseContractOnboarding(current);
  const seller = { ...(base.seller || {}), ...(patch.seller || {}) };
  return {
    ...base,
    ...patch,
    seller: Object.keys(seller).length ? seller : base.seller,
  };
}

export function buildLeadContractSnapshot(lead: Record<string, unknown>): Record<string, unknown> {
  return {
    cnpj: lead.cnpj ?? null,
    legal_representative_name: lead.legal_representative_name ?? null,
    legal_representative_cpf: lead.legal_representative_cpf ?? null,
    legal_representative_email: lead.legal_representative_email ?? null,
    legal_representative_phone: lead.legal_representative_phone ?? null,
    address_cep: lead.address_cep ?? null,
    address_street: lead.address_street ?? null,
    address_number: lead.address_number ?? null,
    address_neighborhood: lead.address_neighborhood ?? null,
    address_complement: lead.address_complement ?? null,
    city: lead.city ?? null,
    state: lead.state ?? null,
    contact_expedition_name: lead.contact_expedition_name ?? null,
    contact_expedition_phone: lead.contact_expedition_phone ?? null,
    contact_financial_name: lead.contact_financial_name ?? null,
    contact_financial_phone: lead.contact_financial_phone ?? null,
    submitted_at: new Date().toISOString(),
  };
}

const SELLER_REQUIRED_KEYS = [
  'legal_name',
  'trade_name',
  'delivery_fee_cents',
  'delivery_fee_driver_payout_cents',
  'setup_cents',
  'drivers_count',
  'delivery_schedule',
  'pickup_address_cep',
  'pickup_address_street',
  'pickup_address_number',
  'pickup_address_neighborhood',
  'pickup_city',
  'pickup_state',
] as const;

function sellerFieldFilled(key: string, seller: ContractOnboardingSeller): boolean {
  if (key === 'delivery_fee_cents' || key === 'delivery_fee_driver_payout_cents' || key === 'setup_cents') {
    return centsFilled(seller[key as keyof ContractOnboardingSeller]);
  }
  if (key === 'drivers_count') {
    return typeof seller.drivers_count === 'number' && seller.drivers_count > 0;
  }
  if (key === 'delivery_schedule') {
    const schedule = seller.delivery_schedule;
    if (!schedule || typeof schedule !== 'object') return false;
    try {
      normalizeDeliveryScheduleInput(schedule);
      return true;
    } catch {
      return false;
    }
  }
  return filled(seller[key as keyof ContractOnboardingSeller]);
}

export function sellerContractChecklist(
  seller: ContractOnboardingSeller | undefined,
  lead: Record<string, unknown>,
): SellerContractChecklist {
  const leadDeliverySchedule = deliveryScheduleFromLeadCustomFields(
    (lead.custom_fields as Record<string, unknown>) || null,
  );
  const merged: ContractOnboardingSeller = {
    ...(seller || {}),
    legal_name: seller?.legal_name || (lead.legal_name as string) || undefined,
    trade_name: seller?.trade_name || (lead.trade_name as string) || undefined,
    delivery_schedule:
      seller?.delivery_schedule ||
      leadDeliverySchedule ||
      undefined,
    pickup_address_cep: seller?.pickup_address_cep || (lead.address_cep as string) || undefined,
    pickup_address_street: seller?.pickup_address_street || (lead.address_street as string) || undefined,
    pickup_address_number: seller?.pickup_address_number || (lead.address_number as string) || undefined,
    pickup_address_neighborhood:
      seller?.pickup_address_neighborhood || (lead.address_neighborhood as string) || undefined,
    pickup_city: seller?.pickup_city || (lead.city as string) || undefined,
    pickup_state: seller?.pickup_state || (lead.state as string) || undefined,
  };

  const missing: string[] = [];
  for (const key of SELLER_REQUIRED_KEYS) {
    if (!sellerFieldFilled(key, merged)) missing.push(key);
  }

  if (merged.setup_parcelado && (!merged.setup_parcelas || merged.setup_parcelas < 2)) {
    missing.push('setup_parcelas');
  }

  const total = SELLER_REQUIRED_KEYS.length + (merged.setup_parcelado ? 1 : 0);
  const filledCount = total - missing.length;
  return {
    total,
    filled: filledCount,
    percent: total ? Math.round((filledCount / total) * 100) : 0,
    missing,
    complete: missing.length === 0,
  };
}

const SELLER_FIELD_LABELS_PT: Record<string, string> = {
  legal_name: 'Razão social',
  trade_name: 'Nome fantasia',
  delivery_fee_cents: 'Taxa de entrega',
  delivery_fee_driver_payout_cents: 'Repasse entregador (taxa)',
  setup_cents: 'Setup',
  drivers_count: 'Nº entregadores',
  delivery_schedule: 'Horários de delivery',
  pickup_address_cep: 'CEP de coleta',
  pickup_address_street: 'Rua de coleta',
  pickup_address_number: 'Número de coleta',
  pickup_address_neighborhood: 'Bairro de coleta',
  pickup_city: 'Cidade de coleta',
  pickup_state: 'UF de coleta',
  setup_parcelas: 'Parcelas do setup',
};

export function sellerContractMissingLabels(missing: string[]): string[] {
  return missing.map((key) => SELLER_FIELD_LABELS_PT[key] || key);
}

export function resolveContractOnboardingStatus(
  onboarding: ContractOnboarding,
  lead: Record<string, unknown>,
): ContractOnboardingStatus {
  const sellerCheck = sellerContractChecklist(onboarding.seller, lead);
  if (sellerCheck.complete) return 'complete';
  if (onboarding.lead_snapshot || onboarding.lead_submitted_at) return 'lead_submitted';
  return 'awaiting_lead';
}

export function parseSellerPatch(input: Record<string, unknown>): {
  seller: ContractOnboardingSeller;
  leadPatch: Record<string, unknown>;
  error: string | null;
} {
  const terms = parseCommercialTermsInput(input);
  const termsErr = validateCommercialTerms(terms);
  if (termsErr) return { seller: {}, leadPatch: {}, error: termsErr };

  let delivery_schedule: Record<string, unknown> | undefined;
  if (input.delivery_schedule !== undefined) {
    try {
      delivery_schedule = normalizeDeliveryScheduleInput(input.delivery_schedule);
    } catch (e) {
      return { seller: {}, leadPatch: {}, error: (e as Error).message };
    }
  }

  const setupParcelado = input.setup_parcelado === true;
  const setupParcelas =
    input.setup_parcelas != null && input.setup_parcelas !== ''
      ? Number(input.setup_parcelas)
      : undefined;

  if (setupParcelado && (setupParcelas == null || setupParcelas < 2)) {
    return { seller: {}, leadPatch: {}, error: 'Informe a quantidade de parcelas do setup (mínimo 2).' };
  }

  const seller: ContractOnboardingSeller = {
    legal_name: input.legal_name ? String(input.legal_name).trim() : undefined,
    trade_name: input.trade_name ? String(input.trade_name).trim() : undefined,
    ...terms,
    setup_cents:
      input.setup_cents != null && input.setup_cents !== ''
        ? Math.max(0, Math.round(Number(input.setup_cents)))
        : undefined,
    setup_parcelado: setupParcelado,
    setup_parcelas: setupParcelado ? setupParcelas : null,
    drivers_count:
      input.drivers_count != null && input.drivers_count !== ''
        ? Math.max(0, Math.round(Number(input.drivers_count)))
        : undefined,
    delivery_schedule,
    pickup_address_cep: input.pickup_address_cep ? String(input.pickup_address_cep).replace(/\D/g, '').slice(0, 8) : undefined,
    pickup_address_street: input.pickup_address_street ? String(input.pickup_address_street).trim() : undefined,
    pickup_address_number: input.pickup_address_number ? String(input.pickup_address_number).trim() : undefined,
    pickup_address_neighborhood: input.pickup_address_neighborhood
      ? String(input.pickup_address_neighborhood).trim()
      : undefined,
    pickup_address_complement: input.pickup_address_complement
      ? String(input.pickup_address_complement).trim()
      : undefined,
    pickup_city: input.pickup_city ? String(input.pickup_city).trim() : undefined,
    pickup_state: input.pickup_state ? String(input.pickup_state).trim().toUpperCase().slice(0, 2) : undefined,
  };

  const leadPatch: Record<string, unknown> = {};
  if (seller.legal_name) leadPatch.legal_name = seller.legal_name;
  if (seller.trade_name) leadPatch.trade_name = seller.trade_name;
  if (seller.drivers_count != null) leadPatch.drivers_count = seller.drivers_count;

  return { seller, leadPatch, error: null };
}

export function hasLeadContractSubmission(onboarding: ContractOnboarding | null | undefined): boolean {
  if (!onboarding) return false;
  return Boolean(onboarding.lead_snapshot || onboarding.lead_submitted_at || onboarding.status === 'lead_submitted' || onboarding.status === 'complete');
}
