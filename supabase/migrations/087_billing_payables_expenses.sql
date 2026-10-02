-- Fase 3 — AP, despesas, fornecedores, export PIX (dev/staging only)

DO $$ BEGIN
  CREATE TYPE public.billing_beneficiary_type AS ENUM ('driver', 'supplier', 'operational');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.billing_payable_status AS ENUM ('draft', 'approved', 'paid', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.billing_payment_method AS ENUM ('pix', 'transfer', 'cash', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.billing_expense_status AS ENUM ('draft', 'approved', 'paid');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.billing_suppliers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name            text NOT NULL,
  cpf_cnpj        text,
  email           text,
  phone           text,
  pix_key         text,
  pix_key_type    text,
  bank_code       text,
  bank_name       text,
  category        text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_suppliers_workspace_name_unique UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS public.billing_payables (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  beneficiary_type      public.billing_beneficiary_type NOT NULL,
  beneficiary_id        uuid,
  legal_entity_type     public.billing_legal_entity_type,
  billing_cycle_id      uuid REFERENCES public.billing_cycles(id) ON DELETE SET NULL,
  description           text NOT NULL DEFAULT '',
  amount_cents          integer NOT NULL CHECK (amount_cents >= 0),
  amount_paid_cents     integer NOT NULL DEFAULT 0 CHECK (amount_paid_cents >= 0),
  status                public.billing_payable_status NOT NULL DEFAULT 'draft',
  due_date              date,
  approved_at           timestamptz,
  approved_by           uuid REFERENCES public.users(id) ON DELETE SET NULL,
  paid_at               timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_payables_paid_lte_amount CHECK (amount_paid_cents <= amount_cents)
);

CREATE INDEX IF NOT EXISTS idx_billing_payables_workspace_status
  ON public.billing_payables (workspace_id, status, due_date);

CREATE INDEX IF NOT EXISTS idx_billing_payables_cycle_driver
  ON public.billing_payables (billing_cycle_id, beneficiary_type)
  WHERE beneficiary_type = 'driver';

CREATE TABLE IF NOT EXISTS public.billing_payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  payable_id        uuid REFERENCES public.billing_payables(id) ON DELETE CASCADE,
  invoice_id        uuid REFERENCES public.billing_invoices(id) ON DELETE SET NULL,
  amount_cents      integer NOT NULL CHECK (amount_cents > 0),
  paid_at           timestamptz NOT NULL DEFAULT now(),
  payment_method    public.billing_payment_method NOT NULL DEFAULT 'pix',
  legal_entity_id   uuid REFERENCES public.billing_legal_entities(id) ON DELETE SET NULL,
  notes             text,
  created_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_payments_payable ON public.billing_payments (payable_id);

CREATE TABLE IF NOT EXISTS public.billing_expenses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  expense_type_id   uuid REFERENCES public.billing_expense_types(id) ON DELETE SET NULL,
  description       text NOT NULL DEFAULT '',
  amount_cents      integer NOT NULL CHECK (amount_cents >= 0),
  expense_date      date NOT NULL,
  cost_center_id    uuid REFERENCES public.billing_cost_centers(id) ON DELETE SET NULL,
  legal_entity_type public.billing_expense_entity NOT NULL DEFAULT 'both',
  allocation        jsonb NOT NULL DEFAULT '{}',
  recurrence        text,
  status            public.billing_expense_status NOT NULL DEFAULT 'draft',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_expenses_workspace_date
  ON public.billing_expenses (workspace_id, expense_date DESC);

CREATE TABLE IF NOT EXISTS public.billing_payment_batch_exports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  billing_cycle_id  uuid NOT NULL REFERENCES public.billing_cycles(id) ON DELETE CASCADE,
  exported_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  total_cents       bigint NOT NULL DEFAULT 0,
  row_count         integer NOT NULL DEFAULT 0,
  file_format       text NOT NULL DEFAULT 'csv',
  metadata          jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_payment_batch_exports_cycle
  ON public.billing_payment_batch_exports (billing_cycle_id, created_at DESC);
