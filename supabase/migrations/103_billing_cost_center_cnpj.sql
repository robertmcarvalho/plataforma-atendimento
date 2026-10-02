-- Billing: garante CNPJ no centro de custo.

ALTER TABLE public.billing_cost_centers
  ADD COLUMN IF NOT EXISTS cnpj text;

COMMENT ON COLUMN public.billing_cost_centers.cnpj IS
  'CNPJ opcional usado para identificação/integração do centro de custo.';

NOTIFY pgrst, 'reload schema';
