-- Campos de cadastro sincronizados com Flux Delivery (API de relatórios)
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS flux_delivery_driver_id text,
  ADD COLUMN IF NOT EXISTS flux_delivery_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp text,
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS cnh_number text,
  ADD COLUMN IF NOT EXISTS cnh_expires_at date,
  ADD COLUMN IF NOT EXISTS pix_key_type text,
  ADD COLUMN IF NOT EXISTS address_cep text,
  ADD COLUMN IF NOT EXISTS address_street text,
  ADD COLUMN IF NOT EXISTS address_number text,
  ADD COLUMN IF NOT EXISTS address_neighborhood text,
  ADD COLUMN IF NOT EXISTS address_complement text,
  ADD COLUMN IF NOT EXISTS vehicle_plate text,
  ADD COLUMN IF NOT EXISTS vehicle_model text,
  ADD COLUMN IF NOT EXISTS vehicle_color text,
  ADD COLUMN IF NOT EXISTS vehicle_renavam text,
  ADD COLUMN IF NOT EXISTS vehicle_model_year text;

COMMENT ON COLUMN public.drivers.flux_delivery_driver_id IS 'ID do entregador na Flux Delivery (idEntregador)';
COMMENT ON COLUMN public.drivers.flux_delivery_synced_at IS 'Última sincronização com API Flux Delivery';
COMMENT ON COLUMN public.drivers.whatsapp IS 'WhatsApp quando diferente do telefone principal';
COMMENT ON COLUMN public.drivers.birth_date IS 'Data de nascimento';
COMMENT ON COLUMN public.drivers.cnh_number IS 'Número da CNH';
COMMENT ON COLUMN public.drivers.cnh_expires_at IS 'Validade da CNH';
COMMENT ON COLUMN public.drivers.pix_key_type IS 'Tipo da chave PIX (CPF, EMAIL, PHONE, RANDOM, etc.)';

CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_workspace_flux_delivery_driver_id
  ON public.drivers(workspace_id, flux_delivery_driver_id)
  WHERE flux_delivery_driver_id IS NOT NULL;
