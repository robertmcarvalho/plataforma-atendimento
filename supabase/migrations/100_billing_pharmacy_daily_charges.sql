-- Diárias automáticas por farmácia no módulo de faturamento.

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS daily_billing_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS daily_billing_rule text NOT NULL DEFAULT 'per_driver_delivery_day'
  CHECK (daily_billing_rule IN ('per_driver_delivery_day', 'fixed_per_driver_cycle'));

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS daily_billing_quantity integer
  CHECK (daily_billing_quantity IS NULL OR daily_billing_quantity >= 0);

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS daily_billing_pharmacy_amount_cents integer
  CHECK (daily_billing_pharmacy_amount_cents IS NULL OR daily_billing_pharmacy_amount_cents >= 0);

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS daily_billing_driver_payout_cents integer
  CHECK (daily_billing_driver_payout_cents IS NULL OR daily_billing_driver_payout_cents >= 0);

COMMENT ON COLUMN public.pharmacies.daily_billing_enabled IS
  'Ativa geração automática de linha daily no acerto da farmácia.';

COMMENT ON COLUMN public.pharmacies.daily_billing_rule IS
  'Regra de diária: por lançamento no Financeiro ou quantidade fixa contratada por farmácia/ciclo (enum fixed_per_driver_cycle).';

COMMENT ON COLUMN public.pharmacies.daily_billing_quantity IS
  'Quantidade de diárias contratadas por farmácia no ciclo quando daily_billing_rule=fixed_per_driver_cycle.';

COMMENT ON COLUMN public.pharmacies.daily_billing_pharmacy_amount_cents IS
  'Valor cobrado da farmácia por diária, em centavos.';

COMMENT ON COLUMN public.pharmacies.daily_billing_driver_payout_cents IS
  'Valor repassado ao entregador por diária automática, em centavos.';
