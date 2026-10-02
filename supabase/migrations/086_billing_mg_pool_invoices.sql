-- Fase 1.1 + Fase 2 — MG compartilhado, split uniforme, faturas AR (dev/staging only)

DO $$ BEGIN
  CREATE TYPE public.billing_mg_mode AS ENUM ('per_driver', 'shared_pool');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.billing_mg_pool_split_rule AS ENUM ('equal', 'by_deliveries');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.billing_invoice_status AS ENUM ('draft', 'approved', 'sent', 'paid');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS mg_mode public.billing_mg_mode NOT NULL DEFAULT 'per_driver';

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS mg_pool_split_rule public.billing_mg_pool_split_rule NOT NULL DEFAULT 'by_deliveries';

COMMENT ON COLUMN public.pharmacies.mg_mode IS 'per_driver = MG por entregador; shared_pool = 1× MG/ciclo rateado';
COMMENT ON COLUMN public.pharmacies.mg_pool_split_rule IS 'Rateio do repasse MG em shared_pool';

ALTER TABLE public.financial_entries
  ADD COLUMN IF NOT EXISTS gross_amount numeric(10, 2);

COMMENT ON COLUMN public.financial_entries.gross_amount IS 'Valor bruto antes de split Coop/entregador (ex. uniforme 50/50)';

CREATE TABLE IF NOT EXISTS public.billing_invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  billing_cycle_id  uuid NOT NULL REFERENCES public.billing_cycles(id) ON DELETE CASCADE,
  pharmacy_id       uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
  entity_type       public.billing_legal_entity_type NOT NULL,
  status            public.billing_invoice_status NOT NULL DEFAULT 'draft',
  invoice_number    text,
  total_cents       integer NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  amount_paid_cents integer NOT NULL DEFAULT 0 CHECK (amount_paid_cents >= 0),
  public_token      text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  due_date          date,
  approved_at       timestamptz,
  approved_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  sent_at           timestamptz,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_invoices_cycle_pharmacy_entity_unique
    UNIQUE (billing_cycle_id, pharmacy_id, entity_type),
  CONSTRAINT billing_invoices_public_token_unique UNIQUE (public_token),
  CONSTRAINT billing_invoices_paid_lte_total CHECK (amount_paid_cents <= total_cents)
);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_workspace_cycle
  ON public.billing_invoices (workspace_id, billing_cycle_id);

CREATE INDEX IF NOT EXISTS idx_billing_invoices_public_token
  ON public.billing_invoices (public_token);

CREATE TABLE IF NOT EXISTS public.billing_invoice_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    uuid NOT NULL REFERENCES public.billing_invoices(id) ON DELETE CASCADE,
  line_order    integer NOT NULL DEFAULT 0,
  description   text NOT NULL,
  quantity      numeric(12, 4) NOT NULL DEFAULT 1,
  unit_cents    integer NOT NULL DEFAULT 0,
  amount_cents  integer NOT NULL DEFAULT 0,
  metadata      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_invoice_lines_invoice
  ON public.billing_invoice_lines (invoice_id, line_order);
