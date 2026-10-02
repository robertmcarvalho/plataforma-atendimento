-- Billing: expense catalog flags, cooperative quota ledger and internal provider ledger.

ALTER TABLE public.billing_expense_types
  ADD COLUMN IF NOT EXISTS affects_dre boolean NOT NULL DEFAULT true;

ALTER TABLE public.billing_payables
  ADD COLUMN IF NOT EXISTS origin_type text,
  ADD COLUMN IF NOT EXISTS origin_id uuid,
  ADD COLUMN IF NOT EXISTS gross_amount_cents integer,
  ADD COLUMN IF NOT EXISTS compensated_amount_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount_cents integer;

CREATE INDEX IF NOT EXISTS idx_billing_payables_origin
  ON public.billing_payables (workspace_id, origin_type, origin_id)
  WHERE origin_type IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.billing_quota_accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  driver_id             uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  integralized_cents    integer NOT NULL DEFAULT 0,
  adjusted_cents        integer NOT NULL DEFAULT 0,
  compensated_cents     integer NOT NULL DEFAULT 0,
  refunded_cents        integer NOT NULL DEFAULT 0,
  balance_cents         integer NOT NULL DEFAULT 0,
  last_movement_at      timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_quota_accounts_workspace_driver_unique UNIQUE (workspace_id, driver_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_quota_accounts_workspace_balance
  ON public.billing_quota_accounts (workspace_id, balance_cents DESC);

CREATE TABLE IF NOT EXISTS public.billing_quota_account_entries (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id               uuid NOT NULL REFERENCES public.billing_quota_accounts(id) ON DELETE CASCADE,
  driver_id                uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  entry_type               text NOT NULL CHECK (entry_type IN ('integralization', 'reversal', 'adjustment', 'compensation', 'refund')),
  amount_cents             integer NOT NULL,
  source_installment_id    uuid REFERENCES public.financial_installments(id) ON DELETE SET NULL,
  source_entry_id          uuid REFERENCES public.financial_entries(id) ON DELETE SET NULL,
  offboarding_preview_id   uuid REFERENCES public.billing_driver_offboarding_previews(id) ON DELETE SET NULL,
  description              text,
  metadata                 jsonb NOT NULL DEFAULT '{}',
  created_by               uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_quota_entries_source_installment_unique UNIQUE (workspace_id, source_installment_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_quota_entries_account_created
  ON public.billing_quota_account_entries (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.billing_quota_offboarding_settlements (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  driver_id                uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  account_id               uuid REFERENCES public.billing_quota_accounts(id) ON DELETE SET NULL,
  offboarding_preview_id   uuid REFERENCES public.billing_driver_offboarding_previews(id) ON DELETE SET NULL,
  gross_quota_cents        integer NOT NULL DEFAULT 0,
  compensated_cents        integer NOT NULL DEFAULT 0,
  net_refund_cents         integer NOT NULL DEFAULT 0,
  payable_id               uuid REFERENCES public.billing_payables(id) ON DELETE SET NULL,
  status                   text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'compensated', 'payable_generated', 'paid', 'cancelled')),
  metadata                 jsonb NOT NULL DEFAULT '{}',
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_quota_offboarding_driver
  ON public.billing_quota_offboarding_settlements (workspace_id, driver_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.billing_provider_accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider_id           uuid NOT NULL REFERENCES public.billing_internal_providers(id) ON DELETE CASCADE,
  balance_cents         integer NOT NULL DEFAULT 0,
  advance_open_cents    integer NOT NULL DEFAULT 0,
  service_credit_cents  integer NOT NULL DEFAULT 0,
  compensated_cents     integer NOT NULL DEFAULT 0,
  paid_cents            integer NOT NULL DEFAULT 0,
  last_movement_at      timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_provider_accounts_workspace_provider_unique UNIQUE (workspace_id, provider_id)
);

CREATE TABLE IF NOT EXISTS public.billing_provider_account_entries (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id            uuid NOT NULL REFERENCES public.billing_provider_accounts(id) ON DELETE CASCADE,
  provider_id           uuid NOT NULL REFERENCES public.billing_internal_providers(id) ON DELETE CASCADE,
  entry_type            text NOT NULL CHECK (entry_type IN ('advance', 'service_credit', 'reimbursement', 'discount', 'compensation', 'payment', 'adjustment')),
  amount_cents          integer NOT NULL,
  cost_center_id        uuid REFERENCES public.billing_cost_centers(id) ON DELETE SET NULL,
  legal_entity_type     public.billing_legal_entity_type,
  payable_id            uuid REFERENCES public.billing_payables(id) ON DELETE SET NULL,
  description           text,
  metadata              jsonb NOT NULL DEFAULT '{}',
  created_by            uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_provider_entries_account_created
  ON public.billing_provider_account_entries (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.billing_provider_advance_schedules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider_id           uuid NOT NULL REFERENCES public.billing_internal_providers(id) ON DELETE CASCADE,
  account_id            uuid REFERENCES public.billing_provider_accounts(id) ON DELETE SET NULL,
  description           text NOT NULL DEFAULT '',
  total_cents           integer NOT NULL CHECK (total_cents > 0),
  installment_count     integer NOT NULL CHECK (installment_count > 0),
  start_date            date NOT NULL,
  frequency             text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  cost_center_id        uuid REFERENCES public.billing_cost_centers(id) ON DELETE SET NULL,
  legal_entity_type     public.billing_legal_entity_type NOT NULL DEFAULT 'coop',
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'settled', 'cancelled')),
  notes                 text,
  created_by            uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.billing_provider_advance_installments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  schedule_id           uuid NOT NULL REFERENCES public.billing_provider_advance_schedules(id) ON DELETE CASCADE,
  provider_id           uuid NOT NULL REFERENCES public.billing_internal_providers(id) ON DELETE CASCADE,
  installment_number    integer NOT NULL,
  amount_cents          integer NOT NULL CHECK (amount_cents > 0),
  due_date              date NOT NULL,
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'compensated', 'cancelled')),
  compensated_at        timestamptz,
  payable_id            uuid REFERENCES public.billing_payables(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_provider_advance_installment_unique UNIQUE (schedule_id, installment_number)
);

CREATE INDEX IF NOT EXISTS idx_billing_provider_advances_provider_status
  ON public.billing_provider_advance_schedules (workspace_id, provider_id, status);

CREATE INDEX IF NOT EXISTS idx_billing_provider_advance_installments_due
  ON public.billing_provider_advance_installments (workspace_id, provider_id, status, due_date);
