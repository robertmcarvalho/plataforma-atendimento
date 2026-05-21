-- Campos operacionais do cadastro de entregadores (alinhado a apps/api-service driverSchema e ensure-supabase-operational-005)
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS is_mei boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mei_cnpj text,
  ADD COLUMN IF NOT EXISTS is_leader boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS leader_role text,
  ADD COLUMN IF NOT EXISTS leader_notes text,
  ADD COLUMN IF NOT EXISTS has_digital_certificate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS digital_certificate_expires_at date;

COMMENT ON COLUMN public.drivers.has_digital_certificate IS 'Indica se o entregador possui certificado digital';
COMMENT ON COLUMN public.drivers.digital_certificate_expires_at IS 'Data de expiração do certificado digital (apenas data)';
