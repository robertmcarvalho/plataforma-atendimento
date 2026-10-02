-- Fase 9 — DRE gerencial (CoopMob × Flux Farma), competência mensal

DO $$ BEGIN
  CREATE TYPE public.billing_dre_line_kind AS ENUM (
    'revenue',
    'variable_cost',
    'fixed_cost',
    'tax',
    'result'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.billing_dre_period_status AS ENUM ('open', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.billing_dre_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type     public.billing_legal_entity_type NOT NULL,
  code            text NOT NULL,
  name            text NOT NULL,
  line_kind       public.billing_dre_line_kind NOT NULL,
  display_order   integer NOT NULL DEFAULT 0,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_dre_accounts_workspace_entity_code UNIQUE (workspace_id, entity_type, code)
);

CREATE INDEX IF NOT EXISTS idx_billing_dre_accounts_workspace_entity
  ON public.billing_dre_accounts (workspace_id, entity_type, active, display_order);

CREATE TABLE IF NOT EXISTS public.billing_dre_tax_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type     public.billing_legal_entity_type NOT NULL,
  tax_code        text NOT NULL,
  name            text NOT NULL DEFAULT '',
  rate_pct        numeric(8, 4) NOT NULL CHECK (rate_pct >= 0 AND rate_pct <= 100),
  effective_from  date,
  effective_until date,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_dre_tax_rules_workspace_entity_code UNIQUE (workspace_id, entity_type, tax_code)
);

CREATE TABLE IF NOT EXISTS public.billing_dre_periods (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type       public.billing_legal_entity_type NOT NULL,
  competence_month  char(7) NOT NULL,
  status            public.billing_dre_period_status NOT NULL DEFAULT 'open',
  closed_at         timestamptz,
  closed_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_dre_periods_unique UNIQUE (workspace_id, entity_type, competence_month)
);

CREATE TABLE IF NOT EXISTS public.billing_dre_snapshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type       public.billing_legal_entity_type NOT NULL,
  competence_month  char(7) NOT NULL,
  calculated_at     timestamptz NOT NULL DEFAULT now(),
  calculated_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  metadata          jsonb NOT NULL DEFAULT '{}',
  CONSTRAINT billing_dre_snapshots_unique UNIQUE (workspace_id, entity_type, competence_month)
);

CREATE TABLE IF NOT EXISTS public.billing_dre_snapshot_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id     uuid NOT NULL REFERENCES public.billing_dre_snapshots(id) ON DELETE CASCADE,
  dre_account_id  uuid NOT NULL REFERENCES public.billing_dre_accounts(id) ON DELETE CASCADE,
  pharmacy_id     uuid REFERENCES public.pharmacies(id) ON DELETE SET NULL,
  amount_cents    bigint NOT NULL DEFAULT 0,
  source_type     text,
  source_meta     jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_dre_snapshot_lines_snapshot
  ON public.billing_dre_snapshot_lines (snapshot_id, dre_account_id);

CREATE INDEX IF NOT EXISTS idx_billing_dre_snapshot_lines_pharmacy
  ON public.billing_dre_snapshot_lines (snapshot_id, pharmacy_id)
  WHERE pharmacy_id IS NOT NULL;

ALTER TABLE public.billing_expense_types
  ADD COLUMN IF NOT EXISTS dre_account_id uuid REFERENCES public.billing_dre_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entity_split_coop_pct numeric(5, 2)
    CHECK (entity_split_coop_pct IS NULL OR (entity_split_coop_pct >= 0 AND entity_split_coop_pct <= 100)),
  ADD COLUMN IF NOT EXISTS entity_split_flux_pct numeric(5, 2)
    CHECK (entity_split_flux_pct IS NULL OR (entity_split_flux_pct >= 0 AND entity_split_flux_pct <= 100));

COMMENT ON TABLE public.billing_dre_accounts IS 'Plano de contas gerencial DRE por entidade (Coop/Flux)';
COMMENT ON TABLE public.billing_dre_tax_rules IS 'Alíquotas imposto na competência da receita (Simples, ISS)';
COMMENT ON TABLE public.billing_dre_periods IS 'Fechamento mensal DRE por entidade';
