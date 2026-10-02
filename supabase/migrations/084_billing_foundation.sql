-- Fase 0 — fundação do módulo /billing (aplicar SOMENTE em banco dev/staging até gate QA)

DO $$ BEGIN
  CREATE TYPE public.billing_contract_scope AS ENUM ('flux_only', 'coop_only', 'both');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.billing_legal_entity_type AS ENUM ('coop', 'flux');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.billing_expense_kind AS ENUM ('fixed', 'variable');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.billing_expense_entity AS ENUM ('coop', 'flux', 'both');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.billing_expense_allocation AS ENUM ('none', 'per_pharmacy', 'per_driver', 'per_delivery');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.billing_bank_account_type AS ENUM ('checking', 'savings');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.billing_cost_centers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name              text NOT NULL,
  code              text,
  cnpj              text,
  split_coop_pct    numeric(5, 2) NOT NULL DEFAULT 50
    CHECK (split_coop_pct >= 0 AND split_coop_pct <= 100),
  split_flux_pct    numeric(5, 2) NOT NULL DEFAULT 50
    CHECK (split_flux_pct >= 0 AND split_flux_pct <= 100),
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_cost_centers_split_sum CHECK (split_coop_pct + split_flux_pct = 100),
  CONSTRAINT billing_cost_centers_workspace_name_unique UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_billing_cost_centers_workspace_active
  ON public.billing_cost_centers (workspace_id, active);

COMMENT ON TABLE public.billing_cost_centers IS 'Catálogo de centros de custo do workspace (CRUD em /billing/config)';

CREATE TABLE IF NOT EXISTS public.billing_expense_types (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name                    text NOT NULL,
  kind                    public.billing_expense_kind NOT NULL DEFAULT 'variable',
  default_cost_center_id  uuid REFERENCES public.billing_cost_centers(id) ON DELETE SET NULL,
  default_entity          public.billing_expense_entity NOT NULL DEFAULT 'both',
  allocation_mode         public.billing_expense_allocation NOT NULL DEFAULT 'none',
  recurrence              text,
  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_expense_types_workspace_name_unique UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_billing_expense_types_workspace_active
  ON public.billing_expense_types (workspace_id, active);

CREATE TABLE IF NOT EXISTS public.billing_legal_entities (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type             public.billing_legal_entity_type NOT NULL,
  legal_name              text NOT NULL DEFAULT '',
  trade_name              text NOT NULL DEFAULT '',
  cnpj                    text,
  state_registration      text,
  municipal_registration  text,
  tax_regime              text,
  address_cep             text,
  address_street          text,
  address_number          text,
  address_neighborhood    text,
  address_city            text,
  address_state           text,
  financial_email         text,
  commercial_email        text,
  phone                   text,
  bank_code               text,
  bank_name               text,
  branch_number           text,
  account_number          text,
  account_digit           text,
  account_type            public.billing_bank_account_type,
  pix_key                 text,
  pix_key_type            text,
  default_split_coop_pct  numeric(5, 2) DEFAULT 50
    CHECK (default_split_coop_pct IS NULL OR (default_split_coop_pct >= 0 AND default_split_coop_pct <= 100)),
  default_split_flux_pct  numeric(5, 2) DEFAULT 50
    CHECK (default_split_flux_pct IS NULL OR (default_split_flux_pct >= 0 AND default_split_flux_pct <= 100)),
  flux_service_margin_pct numeric(5, 2),
  invoice_header_notes    text,
  invoice_footer_notes    text,
  logo_storage_path       text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_legal_entities_workspace_type_unique UNIQUE (workspace_id, entity_type)
);

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS billing_cost_center_id uuid
    REFERENCES public.billing_cost_centers(id) ON DELETE SET NULL;

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS contract_scope public.billing_contract_scope NOT NULL DEFAULT 'both';

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS split_coop_pct numeric(5, 2)
    CHECK (split_coop_pct IS NULL OR (split_coop_pct >= 0 AND split_coop_pct <= 100));

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS split_flux_pct numeric(5, 2)
    CHECK (split_flux_pct IS NULL OR (split_flux_pct >= 0 AND split_flux_pct <= 100));

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS mg_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS minimum_deliveries_count integer
    CHECK (minimum_deliveries_count IS NULL OR minimum_deliveries_count >= 0);

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS billing_email text;

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS flux_codpes integer;

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS flux_codloc integer;

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS inactive_at date;

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS termination_reason text;

CREATE INDEX IF NOT EXISTS idx_pharmacies_billing_cost_center
  ON public.pharmacies (billing_cost_center_id)
  WHERE billing_cost_center_id IS NOT NULL;

COMMENT ON COLUMN public.pharmacies.billing_cost_center_id IS 'Centro de custo de faturamento (select no cadastro; entregador herda via vínculo)';
COMMENT ON COLUMN public.drivers.inactive_at IS 'Data efetiva de desligamento (offboarding)';
