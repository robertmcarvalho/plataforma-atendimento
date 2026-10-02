-- DRE gerencial: classificação administrativa/operacional por categoria e lançamento.

ALTER TABLE public.billing_expense_types
  ADD COLUMN IF NOT EXISTS management_group text NOT NULL DEFAULT 'administrative',
  ADD COLUMN IF NOT EXISTS dre_group text NOT NULL DEFAULT 'administrative_expense',
  ADD COLUMN IF NOT EXISTS allocation_policy text NOT NULL DEFAULT 'revenue_share',
  ADD COLUMN IF NOT EXISTS requires_cost_center boolean NOT NULL DEFAULT false;

ALTER TABLE public.billing_expenses
  ADD COLUMN IF NOT EXISTS management_group text,
  ADD COLUMN IF NOT EXISTS dre_group text,
  ADD COLUMN IF NOT EXISTS allocation_policy text;

ALTER TABLE public.billing_payables
  ADD COLUMN IF NOT EXISTS management_group text,
  ADD COLUMN IF NOT EXISTS dre_group text,
  ADD COLUMN IF NOT EXISTS allocation_policy text;

DO $$
BEGIN
  ALTER TABLE public.billing_expense_types
    ADD CONSTRAINT billing_expense_types_management_group_check
    CHECK (management_group IN ('operational', 'administrative', 'financial', 'tax', 'commercial', 'patrimonial', 'outside_dre'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.billing_expense_types
    ADD CONSTRAINT billing_expense_types_dre_group_check
    CHECK (dre_group IN ('revenue', 'operational_cost', 'administrative_expense', 'financial_expense', 'tax', 'commercial_expense', 'outside_dre'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.billing_expense_types
    ADD CONSTRAINT billing_expense_types_allocation_policy_check
    CHECK (allocation_policy IN ('direct_cost_center', 'revenue_share', 'driver_share', 'delivery_share', 'manual', 'none'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.billing_expenses
    ADD CONSTRAINT billing_expenses_management_group_check
    CHECK (management_group IS NULL OR management_group IN ('operational', 'administrative', 'financial', 'tax', 'commercial', 'patrimonial', 'outside_dre'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.billing_expenses
    ADD CONSTRAINT billing_expenses_dre_group_check
    CHECK (dre_group IS NULL OR dre_group IN ('revenue', 'operational_cost', 'administrative_expense', 'financial_expense', 'tax', 'commercial_expense', 'outside_dre'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.billing_expenses
    ADD CONSTRAINT billing_expenses_allocation_policy_check
    CHECK (allocation_policy IS NULL OR allocation_policy IN ('direct_cost_center', 'revenue_share', 'driver_share', 'delivery_share', 'manual', 'none'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.billing_payables
    ADD CONSTRAINT billing_payables_management_group_check
    CHECK (management_group IS NULL OR management_group IN ('operational', 'administrative', 'financial', 'tax', 'commercial', 'patrimonial', 'outside_dre'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.billing_payables
    ADD CONSTRAINT billing_payables_dre_group_check
    CHECK (dre_group IS NULL OR dre_group IN ('revenue', 'operational_cost', 'administrative_expense', 'financial_expense', 'tax', 'commercial_expense', 'outside_dre'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.billing_payables
    ADD CONSTRAINT billing_payables_allocation_policy_check
    CHECK (allocation_policy IS NULL OR allocation_policy IN ('direct_cost_center', 'revenue_share', 'driver_share', 'delivery_share', 'manual', 'none'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_billing_expense_types_management
  ON public.billing_expense_types (workspace_id, management_group, dre_group)
  WHERE active = true;

