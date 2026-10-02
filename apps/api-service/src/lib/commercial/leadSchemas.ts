import { z } from 'zod';
import { normalizeBrazilPhone, normalizeCnpj, normalizeCpf } from '../brCadastroNormalize';
import { normalizeNameLike } from '../textNormalization';

const brPhone = z
  .string()
  .min(1)
  .transform((v) => normalizeBrazilPhone(v))
  .refine((v) => v.length >= 12, 'Telefone inválido');

const brCnpjOptional = z
  .string()
  .optional()
  .nullable()
  .transform((v) => {
    if (v == null || !String(v).trim()) return undefined;
    return normalizeCnpj(v);
  })
  .refine((v) => v === undefined || v.length === 14, 'CNPJ inválido');

const nameField = z.string().min(1).transform((v) => normalizeNameLike(v) || v);

const optionalNameField = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? normalizeNameLike(v) || v : undefined));

const optionalStateField = z
  .string()
  .optional()
  .nullable()
  .transform((v) => {
    if (!v || !String(v).trim()) return undefined;
    return String(v).trim().toUpperCase().slice(0, 2);
  })
  .refine((v) => v === undefined || v.length === 2, 'UF inválida');

const brCpfOptional = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? normalizeCpf(v) : undefined))
  .refine((v) => v === undefined || v.length === 11, 'CPF inválido');

const brPhoneOptional = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? normalizeBrazilPhone(v) : undefined))
  .refine((v) => v === undefined || v.length >= 12, 'Telefone inválido');

const cepOptional = z
  .string()
  .optional()
  .nullable()
  .transform((v) => {
    if (!v) return undefined;
    const d = String(v).replace(/\D/g, '').slice(0, 8);
    return d.length === 8 ? d : undefined;
  });

const leadLegalAddressFields = {
  legal_representative_name: optionalNameField,
  legal_representative_cpf: brCpfOptional,
  legal_representative_email: z.string().email().optional().nullable(),
  legal_representative_phone: brPhoneOptional,
  address_cep: cepOptional,
  address_street: z.string().optional().nullable(),
  address_number: z.string().optional().nullable(),
  address_neighborhood: z.string().optional().nullable(),
  address_complement: z.string().optional().nullable(),
};

const leadSource = z.enum(['manual', 'instagram', 'indicacao', 'whatsapp', 'campanha', 'referral', 'other']);

export const leadCreateSchema = z.object({
  trade_name: optionalNameField,
  legal_name: z.string().optional().transform((v) => (v ? normalizeNameLike(v) || v : undefined)),
  cnpj: brCnpjOptional,
  phone: brPhone,
  contact_name: optionalNameField,
  contact_email: z.string().email().optional().nullable(),
  contact_role: z.string().optional().nullable(),
  city: optionalNameField,
  state: optionalStateField,
  source: leadSource.default('manual'),
  notes: z.string().optional().nullable(),
  campaign: z.string().optional().nullable(),
  monthly_deliveries: z.number().int().min(0).optional().nullable(),
  drivers_count: z.number().int().min(0).optional().nullable(),
  erp: z.string().optional().nullable(),
  custom_fields: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  deal_value_cents: z.number().int().min(0).optional().nullable(),
  expected_close_at: z.string().optional().nullable(),
  stage_id: z.string().uuid().optional(),
  owner_id: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
  ai_score: z.number().int().min(0).max(100).optional().nullable(),
  lead_temperature: z.enum(['frio', 'morno', 'quente', 'urgente']).optional().nullable(),
  ...leadLegalAddressFields,
});

export const leadPatchSchema = leadCreateSchema.partial().extend({
  stage_id: z.string().uuid().optional(),
  loss_reason_id: z.string().uuid().optional().nullable(),
  loss_notes: z.string().optional().nullable(),
});

export const leadLoseSchema = z.object({
  loss_reason_id: z.string().uuid(),
  notes: z.string().optional().nullable(),
});

export const viabilityCheckSchema = z.object({
  city: z.string().min(1),
  state: z.string().min(2).max(2),
  volume: z.number().int().min(0),
});

export const dimensioningSelectSchema = z.object({
  cenario_id: z.enum(['enxuto', 'enxuto_domingo', 'integral']),
  domingo_aberto: z.boolean().optional(),
});

export const propostaComercialSchema = z
  .object({
    setup_cents: z.number().int().min(0).optional(),
    setup_observacao: z.string().max(2000).optional().nullable(),
    package_name: z.string().min(1).max(120).optional(),
    sem_setup: z.boolean().optional(),
    setup_pagamento: z.enum(['a_vista', 'parcelado']).optional(),
    setup_parcelas: z.number().int().min(2).max(48).optional(),
    cenario_a_domingo_aberto: z.boolean().optional(),
    valor_lead_override_cents: z.number().int().min(0).nullable().optional(),
    override_motivo: z.string().max(500).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.setup_pagamento === 'parcelado' && (data.setup_parcelas == null || data.setup_parcelas < 2)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe a quantidade de parcelas (mínimo 2)',
        path: ['setup_parcelas'],
      });
    }
  });

export const proposalNotesSchema = z.object({
  notes: z.string().max(4000).nullable(),
});

export const proposalCreateSchema = z
  .object({
    lead_id: z.string().uuid(),
    package_name: z.string().min(1).default('Pacote padrão'),
    setup_cents: z.number().int().min(0).default(0),
    setup_pagamento: z.enum(['a_vista', 'parcelado']).optional(),
    setup_parcelas: z.number().int().min(2).max(48).optional(),
    monthly_cents: z.number().int().min(0).default(0),
    mdr_pct: z.number().min(0).max(100).default(0),
    notes: z.string().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.setup_pagamento === 'parcelado' && (data.setup_parcelas == null || data.setup_parcelas < 2)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe a quantidade de parcelas (mínimo 2)',
        path: ['setup_parcelas'],
      });
    }
  });

const optionalPersistedId = z.preprocess((v) => {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const s = v.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s) ? s : undefined;
}, z.string().uuid().optional());

export const pipelineStageInputSchema = z.object({
  id: optionalPersistedId,
  name: z.string().min(1),
  sort_order: z.number().int().min(0),
  color: z.string().optional(),
  probability_pct: z.number().int().min(0).max(100).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  is_won: z.boolean().optional(),
  is_lost: z.boolean().optional(),
  is_entry: z.boolean().optional(),
});

export const fieldDefinitionInputSchema = z.object({
  id: optionalPersistedId,
  slug: z.string().min(1).max(80),
  label: z.string().min(1),
  type: z.enum(['text', 'number', 'select', 'date', 'boolean']).optional(),
  field_type: z.enum(['text', 'number', 'select', 'date', 'boolean']).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  sort_order: z.number().int().min(0).optional(),
});

export const lossReasonInputSchema = z.object({
  id: optionalPersistedId,
  name: z.string().min(1),
  active: z.boolean().optional(),
  sort_order: z.number().int().min(0).optional(),
});

export const erpOptionInputSchema = z.object({
  id: optionalPersistedId,
  name: z.string().min(1).transform((v) => v.trim()),
  active: z.boolean().optional(),
  sort_order: z.number().int().min(0).optional(),
});

const brCpfRequired = z
  .string()
  .min(1)
  .transform((v) => normalizeCpf(v))
  .refine((v) => v.length === 11, 'CPF inválido');

const brCnpjRequired = z
  .string()
  .min(1)
  .transform((v) => normalizeCnpj(v))
  .refine((v) => v.length === 14, 'CNPJ inválido');

const brPhoneRequired = z
  .string()
  .min(1)
  .transform((v) => normalizeBrazilPhone(v))
  .refine((v) => v.length >= 12, 'Telefone inválido');

const cepRequired = z
  .string()
  .min(1)
  .transform((v) => String(v).replace(/\D/g, '').slice(0, 8))
  .refine((v) => v.length === 8, 'CEP inválido');

export const dataRequestPublicSubmitSchema = z.object({
  legal_representative_name: nameField,
  legal_representative_cpf: brCpfRequired,
  legal_representative_email: z.string().email(),
  legal_representative_phone: brPhoneRequired,
  cnpj: brCnpjRequired,
  address_cep: cepRequired,
  address_street: z.string().min(1),
  address_number: z.string().min(1),
  address_neighborhood: z.string().min(1),
  address_complement: z.string().optional().nullable(),
  city: nameField,
  state: z.string().min(2).max(2).transform((v) => v.toUpperCase()),
  contact_expedition_name: nameField,
  contact_expedition_phone: brPhoneRequired,
  contact_financial_name: nameField,
  contact_financial_phone: brPhoneRequired,
});

export const contractOnboardingPatchSchema = z
  .object({
    legal_name: z.string().min(1).optional(),
    trade_name: z.string().min(1).optional(),
    delivery_fee_cents: z.number().int().min(0).optional().nullable(),
    delivery_fee_driver_payout_cents: z.number().int().min(0).optional().nullable(),
    minimum_guaranteed_cents: z.number().int().min(0).optional().nullable(),
    minimum_guaranteed_driver_payout_cents: z.number().int().min(0).optional().nullable(),
    setup_cents: z.number().int().min(0).optional().nullable(),
    setup_parcelado: z.boolean().optional(),
    setup_parcelas: z.number().int().min(2).max(48).optional().nullable(),
    drivers_count: z.number().int().min(1).optional().nullable(),
    delivery_schedule: z.record(z.unknown()).optional(),
    pickup_address_cep: z.string().optional().nullable(),
    pickup_address_street: z.string().optional().nullable(),
    pickup_address_number: z.string().optional().nullable(),
    pickup_address_neighborhood: z.string().optional().nullable(),
    pickup_address_complement: z.string().optional().nullable(),
    pickup_city: z.string().optional().nullable(),
    pickup_state: z.string().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.setup_parcelado && (data.setup_parcelas == null || data.setup_parcelas < 2)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe a quantidade de parcelas do setup (mínimo 2)',
        path: ['setup_parcelas'],
      });
    }
  });
