import { normalizeBrazilPhone, onlyDigits } from '@/lib/brFormat';
import type { CommercialLeadSource } from '@/lib/commercial/types';

export type LeadInput = {
  trade_name?: string;
  phone: string;
  city?: string;
  state?: string;
  contact_name?: string;
  owner_id?: string;
  source: CommercialLeadSource;
  legal_name?: string;
  cnpj?: string;
  contact_email?: string;
  contact_role?: string;
  monthly_deliveries?: number;
  drivers_count?: number;
  erp?: string;
  notes?: string;
  campaign?: string;
  custom_fields?: Record<string, string | number | boolean>;
  tags?: string[];
  deal_value_cents?: number;
  expected_close_at?: string;
  stage_id?: string;
};

export function validateLeadInput(input: LeadInput): string | null {
  const phone = normalizeBrazilPhone(input.phone);
  if (phone.length < 12) return 'Telefone inválido.';
  const state = input.state?.trim().toUpperCase().slice(0, 2) ?? '';
  if (state && state.length !== 2) return 'UF inválida.';
  const cnpj = onlyDigits(input.cnpj ?? '');
  if (cnpj.length > 0 && cnpj.length !== 14) return 'CNPJ inválido (14 dígitos).';
  return null;
}

export function toApiLeadPatch(
  patch: Partial<LeadInput> & { stage_id?: string; loss_reason_id?: string | null; loss_notes?: string | null },
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.trade_name !== undefined) body.trade_name = patch.trade_name?.trim() || null;
  if (patch.legal_name !== undefined) body.legal_name = patch.legal_name?.trim() || undefined;
  if (patch.cnpj !== undefined) {
    const digits = onlyDigits(patch.cnpj);
    body.cnpj = digits.length ? digits : null;
  }
  if (patch.phone !== undefined) body.phone = normalizeBrazilPhone(patch.phone);
  if (patch.city !== undefined) body.city = patch.city?.trim() || null;
  if (patch.state !== undefined) {
    const uf = patch.state?.trim().toUpperCase().slice(0, 2) ?? '';
    body.state = uf || null;
  }
  if (patch.contact_name !== undefined) body.contact_name = patch.contact_name.trim();
  if (patch.contact_email !== undefined) body.contact_email = patch.contact_email?.trim() || null;
  if (patch.contact_role !== undefined) body.contact_role = patch.contact_role?.trim() || null;
  if (patch.owner_id !== undefined) body.owner_id = patch.owner_id;
  if (patch.source !== undefined) body.source = patch.source;
  if (patch.notes !== undefined) body.notes = patch.notes?.trim() || null;
  if (patch.campaign !== undefined) body.campaign = patch.campaign?.trim() || null;
  if (patch.monthly_deliveries !== undefined) body.monthly_deliveries = patch.monthly_deliveries ?? null;
  if (patch.drivers_count !== undefined) body.drivers_count = patch.drivers_count ?? null;
  if (patch.erp !== undefined) body.erp = patch.erp?.trim() || null;
  if (patch.custom_fields !== undefined) body.custom_fields = patch.custom_fields;
  if (patch.tags !== undefined) body.tags = patch.tags;
  if (patch.deal_value_cents !== undefined) body.deal_value_cents = patch.deal_value_cents ?? null;
  if (patch.expected_close_at !== undefined) {
    body.expected_close_at = patch.expected_close_at?.slice(0, 10) || null;
  }
  if (patch.stage_id !== undefined) body.stage_id = patch.stage_id;
  if (patch.loss_reason_id !== undefined) body.loss_reason_id = patch.loss_reason_id;
  if (patch.loss_notes !== undefined) body.loss_notes = patch.loss_notes;
  return body;
}

export function toApiLeadBody(input: LeadInput): Record<string, unknown> {
  const state = input.state?.trim().toUpperCase().slice(0, 2) ?? '';
  return {
    trade_name: input.trade_name?.trim() || null,
    legal_name: input.legal_name?.trim() || undefined,
    cnpj: input.cnpj ? onlyDigits(input.cnpj) : undefined,
    phone: normalizeBrazilPhone(input.phone),
    city: input.city?.trim() || null,
    state: state || null,
    contact_name: input.contact_name?.trim() || undefined,
    contact_email: input.contact_email?.trim() || null,
    contact_role: input.contact_role?.trim() || null,
    owner_id: input.owner_id || undefined,
    source: input.source,
    notes: input.notes?.trim() || null,
    campaign: input.campaign?.trim() || null,
    monthly_deliveries: input.monthly_deliveries ?? null,
    drivers_count: input.drivers_count ?? null,
    erp: input.erp?.trim() || null,
    custom_fields: input.custom_fields ?? {},
    tags: input.tags ?? [],
    deal_value_cents: input.deal_value_cents ?? null,
    expected_close_at: input.expected_close_at?.slice(0, 10) || null,
    stage_id: input.stage_id,
  };
}
