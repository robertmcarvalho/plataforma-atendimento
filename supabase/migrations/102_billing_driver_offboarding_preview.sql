-- Billing: prévia automática de acerto final de desligamento.

CREATE TABLE IF NOT EXISTS public.billing_driver_offboarding_previews (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  driver_id         uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  task_id           uuid REFERENCES public.pending_tasks(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'preview'
    CHECK (status IN ('preview', 'payable_generated', 'cancelled')),
  last_worked_at    date NOT NULL,
  gross_cents       integer NOT NULL DEFAULT 0,
  discount_cents    integer NOT NULL DEFAULT 0,
  net_cents         integer NOT NULL DEFAULT 0,
  payable_id        uuid REFERENCES public.billing_payables(id) ON DELETE SET NULL,
  payload           jsonb NOT NULL DEFAULT '{}',
  created_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_by       uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_driver_offboarding_previews_driver
  ON public.billing_driver_offboarding_previews (workspace_id, driver_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_driver_offboarding_previews_status
  ON public.billing_driver_offboarding_previews (workspace_id, status, created_at DESC);
