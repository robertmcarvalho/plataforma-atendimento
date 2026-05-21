-- Condições comerciais e horário de funcionamento do delivery (farmácias)
ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS delivery_fee_cents integer,
  ADD COLUMN IF NOT EXISTS delivery_fee_driver_payout_cents integer,
  ADD COLUMN IF NOT EXISTS minimum_guaranteed_cents integer,
  ADD COLUMN IF NOT EXISTS minimum_guaranteed_driver_payout_cents integer,
  ADD COLUMN IF NOT EXISTS delivery_schedule jsonb NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.pharmacies.delivery_fee_cents IS 'Taxa de entrega cobrada da farmácia (centavos BRL)';
COMMENT ON COLUMN public.pharmacies.delivery_fee_driver_payout_cents IS 'Repasse da taxa de entrega ao entregador (centavos BRL)';
COMMENT ON COLUMN public.pharmacies.minimum_guaranteed_cents IS 'Mínimo garantido cobrado da farmácia (centavos BRL)';
COMMENT ON COLUMN public.pharmacies.minimum_guaranteed_driver_payout_cents IS 'Repasse do mínimo garantido ao entregador (centavos BRL)';
COMMENT ON COLUMN public.pharmacies.delivery_schedule IS 'Horário de funcionamento do delivery (formato business hours: timezone, weekly, holidays)';
