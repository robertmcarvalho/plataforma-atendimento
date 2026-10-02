-- Billing: agenda geral de pagamentos, lotes PIX/C6 por AP e governança de ciclos.

ALTER TABLE public.billing_payables
  ADD COLUMN IF NOT EXISTS scheduled_payment_date date,
  ADD COLUMN IF NOT EXISTS payment_method public.billing_payment_method NOT NULL DEFAULT 'pix',
  ADD COLUMN IF NOT EXISTS payment_bank_account_id uuid REFERENCES public.billing_bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pix_key text,
  ADD COLUMN IF NOT EXISTS pix_key_type text,
  ADD COLUMN IF NOT EXISTS batch_eligible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS payment_batch_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payment_batch_export_id uuid REFERENCES public.billing_payment_batch_exports(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_batch_exported_at timestamptz;

ALTER TABLE public.billing_payment_batch_exports
  ALTER COLUMN billing_cycle_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.billing_bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS legal_entity_type public.billing_legal_entity_type,
  ADD COLUMN IF NOT EXISTS payment_date date,
  ADD COLUMN IF NOT EXISTS batch_kind text NOT NULL DEFAULT 'driver_cycle';

CREATE INDEX IF NOT EXISTS idx_billing_payables_schedule
  ON public.billing_payables (workspace_id, scheduled_payment_date, payment_method, payment_batch_status)
  WHERE status IN ('draft', 'approved') AND batch_eligible = true;

CREATE INDEX IF NOT EXISTS idx_billing_payables_batch_export
  ON public.billing_payables (workspace_id, payment_batch_export_id)
  WHERE payment_batch_export_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_payment_batch_exports_schedule
  ON public.billing_payment_batch_exports (workspace_id, payment_date DESC, batch_kind);

CREATE TABLE IF NOT EXISTS public.billing_payment_batch_export_payables (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  batch_export_id   uuid NOT NULL REFERENCES public.billing_payment_batch_exports(id) ON DELETE CASCADE,
  payable_id        uuid NOT NULL REFERENCES public.billing_payables(id) ON DELETE CASCADE,
  amount_cents      integer NOT NULL CHECK (amount_cents > 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_payment_batch_export_payables_unique UNIQUE (batch_export_id, payable_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_payment_batch_export_payables_workspace
  ON public.billing_payment_batch_export_payables (workspace_id, payable_id);

UPDATE public.billing_payables
SET
  scheduled_payment_date = COALESCE(scheduled_payment_date, effective_due_date, due_date),
  payment_method = COALESCE(payment_method, 'pix'::public.billing_payment_method),
  payment_batch_status = COALESCE(payment_batch_status, 'pending'),
  batch_eligible = COALESCE(batch_eligible, true)
WHERE scheduled_payment_date IS NULL
   OR payment_batch_status IS NULL;

DO $$
BEGIN
  ALTER TABLE public.billing_payables
    ADD CONSTRAINT billing_payables_batch_status_check
    CHECK (payment_batch_status IN ('pending', 'exported', 'paid', 'cancelled')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
