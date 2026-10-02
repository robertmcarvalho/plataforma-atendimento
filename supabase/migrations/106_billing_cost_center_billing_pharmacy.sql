-- Billing: farmacia representante para faturamento consolidado por centro de custo.

ALTER TABLE public.billing_cost_centers
  ADD COLUMN IF NOT EXISTS billing_pharmacy_id uuid
    REFERENCES public.pharmacies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_billing_cost_centers_billing_pharmacy
  ON public.billing_cost_centers (workspace_id, billing_pharmacy_id)
  WHERE billing_pharmacy_id IS NOT NULL;

COMMENT ON COLUMN public.billing_cost_centers.billing_pharmacy_id IS
  'Farmacia representante que recebe fatura/relatorio consolidado do centro de custo.';
