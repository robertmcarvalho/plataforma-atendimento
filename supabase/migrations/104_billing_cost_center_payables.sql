-- Centro de custo gerencial para APs/pagamentos e centros corporativos Coop/Flux.

ALTER TABLE public.billing_cost_centers
  ADD COLUMN IF NOT EXISTS corporate_entity_type public.billing_legal_entity_type;

CREATE INDEX IF NOT EXISTS idx_billing_cost_centers_corporate_entity
  ON public.billing_cost_centers (workspace_id, corporate_entity_type)
  WHERE corporate_entity_type IS NOT NULL;

ALTER TABLE public.billing_payables
  ADD COLUMN IF NOT EXISTS cost_center_id uuid
    REFERENCES public.billing_cost_centers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_billing_payables_cost_center
  ON public.billing_payables (workspace_id, cost_center_id)
  WHERE cost_center_id IS NOT NULL;

ALTER TABLE public.billing_payments
  ADD COLUMN IF NOT EXISTS cost_center_id uuid
    REFERENCES public.billing_cost_centers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_billing_payments_cost_center
  ON public.billing_payments (workspace_id, cost_center_id)
  WHERE cost_center_id IS NOT NULL;

INSERT INTO public.billing_cost_centers (
  workspace_id,
  name,
  code,
  split_coop_pct,
  split_flux_pct,
  active,
  corporate_entity_type,
  updated_at
)
SELECT
  w.id,
  'Cooperativa',
  'COOP',
  100,
  0,
  true,
  'coop'::public.billing_legal_entity_type,
  now()
FROM public.workspaces w
ON CONFLICT (workspace_id, name) DO UPDATE
SET
  code = COALESCE(public.billing_cost_centers.code, EXCLUDED.code),
  corporate_entity_type = 'coop'::public.billing_legal_entity_type,
  split_coop_pct = 100,
  split_flux_pct = 0,
  active = true,
  updated_at = now();

INSERT INTO public.billing_cost_centers (
  workspace_id,
  name,
  code,
  split_coop_pct,
  split_flux_pct,
  active,
  corporate_entity_type,
  updated_at
)
SELECT
  w.id,
  'Flux Farma',
  'FLUX',
  0,
  100,
  true,
  'flux'::public.billing_legal_entity_type,
  now()
FROM public.workspaces w
ON CONFLICT (workspace_id, name) DO UPDATE
SET
  code = COALESCE(public.billing_cost_centers.code, EXCLUDED.code),
  corporate_entity_type = 'flux'::public.billing_legal_entity_type,
  split_coop_pct = 0,
  split_flux_pct = 100,
  active = true,
  updated_at = now();
