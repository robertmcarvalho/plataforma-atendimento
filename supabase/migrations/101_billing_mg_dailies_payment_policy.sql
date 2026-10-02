-- Billing: MG sem entregas, tratamento de diárias, política de pagamento e auditoria.

ALTER TABLE public.financial_entries
  ADD COLUMN IF NOT EXISTS daily_billing_treatment text NOT NULL DEFAULT 'pending_audit'
    CHECK (daily_billing_treatment IN ('charge_pharmacy', 'absorb_operation', 'pending_audit')),
  ADD COLUMN IF NOT EXISTS daily_pharmacy_charge_amount numeric(10, 2),
  ADD COLUMN IF NOT EXISTS daily_billing_decided_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS daily_billing_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS daily_billing_notes text;

COMMENT ON COLUMN public.financial_entries.daily_billing_treatment IS
  'Tratamento de faturamento para diária: cobrar farmácia, absorver operação ou auditar.';
COMMENT ON COLUMN public.financial_entries.daily_pharmacy_charge_amount IS
  'Valor em reais a cobrar da farmácia quando daily_billing_treatment=charge_pharmacy.';

ALTER TABLE public.billing_cost_centers
  ADD COLUMN IF NOT EXISTS cycle_closes_weekday integer NOT NULL DEFAULT 7
    CHECK (cycle_closes_weekday BETWEEN 1 AND 7),
  ADD COLUMN IF NOT EXISTS cycle_review_weekday integer NOT NULL DEFAULT 1
    CHECK (cycle_review_weekday BETWEEN 1 AND 7),
  ADD COLUMN IF NOT EXISTS invoice_issue_weekday integer NOT NULL DEFAULT 1
    CHECK (invoice_issue_weekday BETWEEN 1 AND 7),
  ADD COLUMN IF NOT EXISTS invoice_due_weekday integer NOT NULL DEFAULT 3
    CHECK (invoice_due_weekday BETWEEN 1 AND 7),
  ADD COLUMN IF NOT EXISTS invoice_due_week_offset integer NOT NULL DEFAULT 0
    CHECK (invoice_due_week_offset BETWEEN 0 AND 8),
  ADD COLUMN IF NOT EXISTS driver_payment_weekday integer NOT NULL DEFAULT 4
    CHECK (driver_payment_weekday BETWEEN 1 AND 7),
  ADD COLUMN IF NOT EXISTS driver_payment_week_offset integer NOT NULL DEFAULT 0
    CHECK (driver_payment_week_offset BETWEEN 0 AND 8),
  ADD COLUMN IF NOT EXISTS driver_payment_release_condition text NOT NULL DEFAULT 'invoice_paid_or_manager_release'
    CHECK (driver_payment_release_condition IN ('invoice_paid', 'manager_release', 'invoice_paid_or_manager_release', 'none')),
  ADD COLUMN IF NOT EXISTS allow_partial_driver_payment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS block_c6_without_invoice_payment boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS invoice_holiday_policy text NOT NULL DEFAULT 'next_business_day'
    CHECK (invoice_holiday_policy IN ('previous_business_day', 'next_business_day', 'keep_requires_approval')),
  ADD COLUMN IF NOT EXISTS driver_payment_holiday_policy text NOT NULL DEFAULT 'previous_business_day'
    CHECK (driver_payment_holiday_policy IN ('previous_business_day', 'next_business_day', 'keep_requires_approval')),
  ADD COLUMN IF NOT EXISTS require_manager_release_reason boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS default_coverage_daily_billing_treatment text NOT NULL DEFAULT 'pending_audit'
    CHECK (default_coverage_daily_billing_treatment IN ('charge_pharmacy', 'absorb_operation', 'pending_audit'));

COMMENT ON COLUMN public.billing_cost_centers.driver_payment_release_condition IS
  'Condição para liberar pagamento do entregador: baixa da fatura, gestor, ambos/um deles ou nenhuma.';
COMMENT ON COLUMN public.billing_cost_centers.driver_payment_holiday_policy IS
  'Como ajustar pagamento do entregador quando a data cair em feriado ou fim de semana.';

CREATE TABLE IF NOT EXISTS public.billing_holidays (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  holiday_date   date NOT NULL,
  name           text NOT NULL,
  scope          text NOT NULL DEFAULT 'workspace'
    CHECK (scope IN ('national', 'state', 'city', 'workspace')),
  state          text,
  city           text,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_holidays_workspace_date_name_unique UNIQUE (workspace_id, holiday_date, name)
);

CREATE INDEX IF NOT EXISTS idx_billing_holidays_workspace_date
  ON public.billing_holidays (workspace_id, holiday_date)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS public.billing_audit_notifications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  billing_cycle_id  uuid REFERENCES public.billing_cycles(id) ON DELETE CASCADE,
  pharmacy_id       uuid REFERENCES public.pharmacies(id) ON DELETE SET NULL,
  driver_id         uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  severity          text NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('info', 'warning', 'critical')),
  code              text NOT NULL,
  title             text NOT NULL,
  message           text NOT NULL,
  status            text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved')),
  metadata          jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  resolved_by       uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_audit_notifications_cycle_status
  ON public.billing_audit_notifications (workspace_id, billing_cycle_id, status, created_at DESC);

ALTER TABLE public.billing_payables
  ADD COLUMN IF NOT EXISTS original_due_date date,
  ADD COLUMN IF NOT EXISTS effective_due_date date,
  ADD COLUMN IF NOT EXISTS payment_blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS block_reason text,
  ADD COLUMN IF NOT EXISTS manager_released_at timestamptz,
  ADD COLUMN IF NOT EXISTS manager_released_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_release_reason text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}';

ALTER TABLE public.billing_payment_batch_exports
  ADD COLUMN IF NOT EXISTS payment_date date;

CREATE INDEX IF NOT EXISTS idx_billing_payables_cycle_due_date
  ON public.billing_payables (workspace_id, billing_cycle_id, due_date, beneficiary_type, status);
