-- Fase 6 — Folha empresa: prestadores internos e sócios (dev/staging only)

ALTER TYPE public.billing_beneficiary_type ADD VALUE IF NOT EXISTS 'internal_provider';
ALTER TYPE public.billing_beneficiary_type ADD VALUE IF NOT EXISTS 'shareholder';

ALTER TYPE public.billing_expense_allocation ADD VALUE IF NOT EXISTS 'per_provider';

ALTER TABLE public.billing_payables
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS competence_month char(7);

CREATE INDEX IF NOT EXISTS idx_billing_payables_competence
  ON public.billing_payables (workspace_id, beneficiary_type, competence_month)
  WHERE competence_month IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.billing_internal_providers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  legal_name            text NOT NULL,
  trade_name            text,
  cpf_cnpj              text,
  contract_type         text NOT NULL DEFAULT 'pj',
  role_title            text,
  email                 text,
  phone                 text,
  phone_secondary       text,
  financial_email       text,
  address_cep           text,
  address_street        text,
  address_number        text,
  address_neighborhood  text,
  address_city          text,
  address_state         text,
  pix_key               text,
  pix_key_type          text,
  bank_code             text,
  bank_name             text,
  branch_number         text,
  account_number        text,
  account_digit         text,
  account_type          public.billing_bank_account_type,
  default_entity        public.billing_legal_entity_type NOT NULL DEFAULT 'coop',
  default_cost_center_id uuid REFERENCES public.billing_cost_centers(id) ON DELETE SET NULL,
  contract_started_at   date,
  inactive_at           date,
  termination_reason    text,
  default_monthly_cents integer CHECK (default_monthly_cents IS NULL OR default_monthly_cents >= 0),
  active                boolean NOT NULL DEFAULT true,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_internal_providers_workspace_cpf_unique UNIQUE (workspace_id, cpf_cnpj)
);

CREATE INDEX IF NOT EXISTS idx_billing_internal_providers_workspace_active
  ON public.billing_internal_providers (workspace_id, active, legal_name);

CREATE TABLE IF NOT EXISTS public.billing_shareholders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type           public.billing_legal_entity_type NOT NULL,
  legal_name            text NOT NULL,
  trade_name            text,
  cpf_cnpj              text,
  email                 text,
  phone                 text,
  financial_email       text,
  address_cep           text,
  address_street        text,
  address_number        text,
  address_neighborhood  text,
  address_city          text,
  address_state         text,
  pix_key               text,
  pix_key_type          text,
  bank_code             text,
  bank_name             text,
  branch_number         text,
  account_number        text,
  account_digit         text,
  account_type          public.billing_bank_account_type,
  ownership_pct         numeric(5, 2) CHECK (ownership_pct IS NULL OR (ownership_pct >= 0 AND ownership_pct <= 100)),
  pro_labore_default_cents integer NOT NULL DEFAULT 0 CHECK (pro_labore_default_cents >= 0),
  is_administrator      boolean NOT NULL DEFAULT false,
  contract_started_at   date,
  inactive_at           date,
  termination_reason    text,
  active                boolean NOT NULL DEFAULT true,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_shareholders_workspace_cpf_unique UNIQUE (workspace_id, cpf_cnpj)
);

CREATE INDEX IF NOT EXISTS idx_billing_shareholders_workspace_active
  ON public.billing_shareholders (workspace_id, entity_type, active);
