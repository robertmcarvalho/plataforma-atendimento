-- Separação repasse operacional (DRE) × deduções financeiras cooperativas (fora da margem).

ALTER TABLE public.billing_settlements
  ADD COLUMN IF NOT EXISTS operational_net_driver_payout_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS financial_deduction_cents integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.billing_settlements.operational_net_driver_payout_cents IS
  'Repasse operacional (entregas/MG/diárias − faltas) — base do DRE C-CV-REP.';
COMMENT ON COLUMN public.billing_settlements.financial_deduction_cents IS
  'Descontos financeiros cooperativos (cota, adiantamento, uniforme…) — fora da margem; reduzem apenas o PIX.';

UPDATE public.billing_settlements
SET
  operational_net_driver_payout_cents = net_driver_payout_cents,
  financial_deduction_cents = 0
WHERE operational_net_driver_payout_cents = 0
  AND financial_deduction_cents = 0
  AND net_driver_payout_cents <> 0;

CREATE TABLE IF NOT EXISTS public.billing_driver_financial_ledger_entries (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  driver_id                uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  entry_type               text NOT NULL CHECK (
    entry_type IN (
      'advance_recovery',
      'uniform_recovery',
      'bag_recovery',
      'digital_cert_recovery',
      'other_financial_recovery'
    )
  ),
  amount_cents             integer NOT NULL,
  source_installment_id    uuid REFERENCES public.financial_installments(id) ON DELETE SET NULL,
  source_entry_id          uuid REFERENCES public.financial_entries(id) ON DELETE SET NULL,
  billing_cycle_id         uuid REFERENCES public.billing_cycles(id) ON DELETE SET NULL,
  settlement_id            uuid REFERENCES public.billing_settlements(id) ON DELETE SET NULL,
  description              text,
  metadata                 jsonb NOT NULL DEFAULT '{}',
  created_by               uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_driver_financial_ledger_installment_unique
    UNIQUE (workspace_id, source_installment_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_driver_financial_ledger_driver_created
  ON public.billing_driver_financial_ledger_entries (workspace_id, driver_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_driver_financial_ledger_cycle
  ON public.billing_driver_financial_ledger_entries (workspace_id, billing_cycle_id)
  WHERE billing_cycle_id IS NOT NULL;
