-- Fase 7 — Parceiros comerciais, regras de comissão e provisões (dev/staging only)
-- FK em commercial_leads é aplicada somente se a tabela CRM existir no banco.

ALTER TYPE public.billing_beneficiary_type ADD VALUE IF NOT EXISTS 'commercial_partner';

CREATE TABLE IF NOT EXISTS public.billing_commercial_partners (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  legal_name            text NOT NULL,
  trade_name            text,
  cpf_cnpj              text,
  partner_kind          text NOT NULL DEFAULT 'sales_agent'
    CHECK (partner_kind IN ('sales_agent', 'referrer', 'both')),
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
  default_entity        public.billing_legal_entity_type NOT NULL DEFAULT 'coop',
  contract_started_at   date,
  inactive_at           date,
  active                boolean NOT NULL DEFAULT true,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_commercial_partners_workspace_cpf_unique UNIQUE (workspace_id, cpf_cnpj)
);

CREATE INDEX IF NOT EXISTS idx_billing_commercial_partners_workspace_active
  ON public.billing_commercial_partners (workspace_id, partner_kind, active, legal_name);

CREATE TABLE IF NOT EXISTS public.billing_commission_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  partner_id        uuid NOT NULL REFERENCES public.billing_commercial_partners(id) ON DELETE CASCADE,
  role_type         text NOT NULL CHECK (role_type IN ('sales_agent', 'referrer')),
  calculation_basis text NOT NULL CHECK (calculation_basis IN ('percent_deal_value', 'fixed_per_conversion')),
  percent_value     numeric(6, 3) CHECK (percent_value IS NULL OR (percent_value >= 0 AND percent_value <= 100)),
  fixed_cents       integer CHECK (fixed_cents IS NULL OR fixed_cents >= 0),
  active            boolean NOT NULL DEFAULT true,
  effective_from    date,
  effective_until   date,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_commission_rules_partner_role_unique UNIQUE (workspace_id, partner_id, role_type)
);

CREATE INDEX IF NOT EXISTS idx_billing_commission_rules_partner
  ON public.billing_commission_rules (workspace_id, partner_id, active);

CREATE TABLE IF NOT EXISTS public.billing_commission_accruals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  partner_id          uuid NOT NULL REFERENCES public.billing_commercial_partners(id) ON DELETE RESTRICT,
  commercial_lead_id  uuid NOT NULL,
  pharmacy_id         uuid REFERENCES public.pharmacies(id) ON DELETE SET NULL,
  commission_role     text NOT NULL CHECK (commission_role IN ('sales_agent', 'referrer')),
  rule_id             uuid REFERENCES public.billing_commission_rules(id) ON DELETE SET NULL,
  competence_month    char(7) NOT NULL,
  amount_cents        integer NOT NULL CHECK (amount_cents >= 0),
  deal_value_cents    bigint,
  status              text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'cancelled')),
  payable_id          uuid REFERENCES public.billing_payables(id) ON DELETE SET NULL,
  converted_at        timestamptz,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_commission_accruals_lead_role_unique UNIQUE (workspace_id, commercial_lead_id, commission_role)
);

CREATE INDEX IF NOT EXISTS idx_billing_commission_accruals_month
  ON public.billing_commission_accruals (workspace_id, competence_month, partner_id);

CREATE INDEX IF NOT EXISTS idx_billing_commission_accruals_payable
  ON public.billing_commission_accruals (payable_id)
  WHERE payable_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'commercial_leads'
  ) THEN
    ALTER TABLE public.commercial_leads
      ADD COLUMN IF NOT EXISTS sales_partner_id uuid REFERENCES public.billing_commercial_partners(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS referrer_partner_id uuid REFERENCES public.billing_commercial_partners(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_commercial_leads_sales_partner
      ON public.commercial_leads (workspace_id, sales_partner_id)
      WHERE sales_partner_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_commercial_leads_referrer_partner
      ON public.commercial_leads (workspace_id, referrer_partner_id)
      WHERE referrer_partner_id IS NOT NULL;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'billing_commission_accruals_commercial_lead_id_fkey'
    ) THEN
      ALTER TABLE public.billing_commission_accruals
        ADD CONSTRAINT billing_commission_accruals_commercial_lead_id_fkey
        FOREIGN KEY (commercial_lead_id) REFERENCES public.commercial_leads(id) ON DELETE CASCADE;
    END IF;
  END IF;
END $$;
