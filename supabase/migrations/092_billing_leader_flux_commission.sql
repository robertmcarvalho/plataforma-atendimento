-- Fase 7 (pendência) — Comissão líder de operação sobre margem Flux
-- FK em leaders aplicada somente se a tabela existir no banco.

ALTER TYPE public.billing_beneficiary_type ADD VALUE IF NOT EXISTS 'leader';

CREATE TABLE IF NOT EXISTS public.billing_leader_commission_rules (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  leader_id               uuid NOT NULL,
  percent_of_flux_margin  numeric(6, 3) NOT NULL DEFAULT 0
    CHECK (percent_of_flux_margin >= 0 AND percent_of_flux_margin <= 100),
  active                  boolean NOT NULL DEFAULT true,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_leader_commission_rules_workspace_leader_unique UNIQUE (workspace_id, leader_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_leader_commission_rules_workspace
  ON public.billing_leader_commission_rules (workspace_id, active);

CREATE TABLE IF NOT EXISTS public.billing_leader_commission_accruals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  leader_id             uuid NOT NULL,
  pharmacy_id           uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  competence_month      char(7) NOT NULL,
  flux_billing_cents    integer NOT NULL DEFAULT 0 CHECK (flux_billing_cents >= 0),
  flux_margin_cents     integer NOT NULL DEFAULT 0 CHECK (flux_margin_cents >= 0),
  margin_pct_applied    numeric(6, 3) NOT NULL DEFAULT 0,
  commission_pct_applied numeric(6, 3) NOT NULL DEFAULT 0,
  amount_cents          integer NOT NULL CHECK (amount_cents >= 0),
  status                text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'cancelled')),
  payable_id            uuid REFERENCES public.billing_payables(id) ON DELETE SET NULL,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_leader_commission_accruals_unique UNIQUE (workspace_id, leader_id, pharmacy_id, competence_month)
);

CREATE INDEX IF NOT EXISTS idx_billing_leader_commission_accruals_month
  ON public.billing_leader_commission_accruals (workspace_id, competence_month, leader_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'leaders'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'billing_leader_commission_rules_leader_id_fkey'
    ) THEN
      ALTER TABLE public.billing_leader_commission_rules
        ADD CONSTRAINT billing_leader_commission_rules_leader_id_fkey
        FOREIGN KEY (leader_id) REFERENCES public.leaders(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'billing_leader_commission_accruals_leader_id_fkey'
    ) THEN
      ALTER TABLE public.billing_leader_commission_accruals
        ADD CONSTRAINT billing_leader_commission_accruals_leader_id_fkey
        FOREIGN KEY (leader_id) REFERENCES public.leaders(id) ON DELETE RESTRICT;
    END IF;
  END IF;
END $$;
